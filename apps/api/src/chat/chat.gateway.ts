import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ChatService } from './chat.service';
import { PrismaService } from '../prisma/prisma.service';
import { resolveJwtSecret } from '../common/jwt-secret';

@WebSocketGateway({
  cors: {
    origin: [
      process.env.WEB_URL ?? 'http://localhost:3000',
      process.env.ADMIN_URL ?? 'http://localhost:3001',
    ],
  },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  constructor(
    private jwt: JwtService,
    private config: ConfigService,
    private chat: ChatService,
    private prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.headers.authorization?.replace('Bearer ', '') ?? '');
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token, {
        secret: resolveJwtSecret(this.config),
      });
      const banned = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { isBanned: true },
      });
      if (!banned || banned.isBanned) {
        client.disconnect();
        return;
      }
      client.data.userId = payload.sub;
      client.join(`user:${payload.sub}`);
    } catch {
      client.disconnect();
    }
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
