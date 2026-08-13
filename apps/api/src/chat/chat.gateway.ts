import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ChatService } from './chat.service';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';
import { resolveJwtSecret } from '../common/jwt-secret';
import { accessTokenIsCurrent } from '../auth/access-token';

@WebSocketGateway({
  cors: {
    origin: [
      process.env.WEB_URL ?? 'http://localhost:3000',
      process.env.ADMIN_URL ?? 'http://localhost:3001',
    ],
  },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(
    private jwt: JwtService,
    private config: ConfigService,
    private chat: ChatService,
    private prisma: PrismaService,
    private presence: PresenceService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.headers.authorization?.replace('Bearer ', '') ?? '');
      const payload = await this.jwt.verifyAsync<{ sub: string; tv?: number }>(token, {
        secret: resolveJwtSecret(this.config),
      });
      const account = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { isBanned: true, tokenVersion: true },
      });
      if (!account || account.isBanned || !accessTokenIsCurrent(payload.tv, account.tokenVersion)) {
        client.disconnect();
        return;
      }
      client.data.userId = payload.sub;
      client.join(`user:${payload.sub}`);

      const cameOnline = await this.presence.markOnline(payload.sub, client.id);
      if (cameOnline) {
        void this.notifyPeers(payload.sub, { isOnline: true, lastSeenAt: null });
      }
    } catch {
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data.userId as string | undefined;
    if (!userId) return;
    const wentOffline = await this.presence.markOffline(userId, client.id);
    if (wentOffline) {
      void this.notifyPeers(userId, {
        isOnline: false,
        lastSeenAt: new Date().toISOString(),
      });
    }
  }

  /** Push presence flips to users who share a conversation with `userId`. */
  private async notifyPeers(
    userId: string,
    status: { isOnline: boolean; lastSeenAt: string | null },
  ) {
    try {
      const conversations = await this.prisma.conversation.findMany({
        where: { OR: [{ userAId: userId }, { userBId: userId }] },
        select: { userAId: true, userBId: true },
      });
      const peers = new Set<string>();
      for (const c of conversations) {
        peers.add(c.userAId === userId ? c.userBId : c.userAId);
      }
      for (const peerId of peers) {
        this.server.to(`user:${peerId}`).emit('presence:update', { userId, ...status });
      }
    } catch {
      /* presence is best-effort */
    }
  }

  @SubscribeMessage('presence:ping')
  async onPresencePing(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId as string | undefined;
    if (!userId) return { ok: false };
    await this.presence.heartbeat(userId, client.id);
    return { ok: true };
  }

  @SubscribeMessage('message:send')
  async onMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; body: string },
  ) {
    const userId = client.data.userId as string;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.isBanned) {
      client.disconnect();
      return;
    }
    const message = await this.chat.sendMessage(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        fullName: user.fullName,
        isBanned: user.isBanned,
      },
      data.conversationId,
      data.body,
    );
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: data.conversationId },
    });
    if (conversation) {
      this.server.to(`user:${conversation.userAId}`).emit('message:new', message);
      this.server.to(`user:${conversation.userBId}`).emit('message:new', message);
    }
    return message;
  }
}
