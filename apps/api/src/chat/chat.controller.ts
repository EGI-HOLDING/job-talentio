import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { chatMessageSchema } from '@job-talentio/shared';
import { ChatService } from './chat.service';
import { JwtAuthGuard, CurrentUser, AuthUser } from '../common/auth.decorators';
import { parseDto } from '../common/utils';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private chat: ChatService) {}

  @Get('conversations')
  list(@CurrentUser() user: AuthUser) {
    return this.chat.listConversations(user);
  }

  @Post('conversations')
  start(
    @CurrentUser() user: AuthUser,
    @Body() body: { peerUserId: string; jobPostId?: string; companyId?: string },
  ) {
    return this.chat.startConversation(user, body.peerUserId, body);
  }

  @Get('conversations/:id/messages')
  messages(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chat.getMessages(user, id);
  }

  @Post('conversations/:id/messages')
  send(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = parseDto(chatMessageSchema, body);
    return this.chat.sendMessage(user, id, data.body);
  }
}
