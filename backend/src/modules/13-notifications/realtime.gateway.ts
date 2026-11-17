import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Role } from '@common/security/roles.enum';

interface AuthenticatedSocket extends Socket {
  data: {
    userId?: string;
    role?: Role;
    businessId?: string;
  };
}

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  path: '/realtime',
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(private readonly jwtService: JwtService) {}

  handleConnection(client: AuthenticatedSocket): void {
    try {
      const authHeader =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization ||
        client.handshake.query?.token;

      if (!authHeader) {
        client.disconnect(true);
        return;
      }

      const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : String(authHeader).trim();

      const payload = this.jwtService.verify<{
        sub: string;
        role: Role;
        businessId?: string;
      }>(token);

      client.data = {
        userId: payload.sub,
        role: payload.role,
        businessId: payload.businessId,
      };

      if (payload.role === Role.SUPER_ADMIN) {
        void client.join('role:SUPER_ADMIN');
      }
      if (payload.businessId) {
        void client.join(`business:${payload.businessId}`);
      }
      void client.join(`user:${payload.sub}`);

      this.logger.log(`[REALTIME-CONNECTED] socketId=${client.id} userId=${payload.sub} role=${payload.role}`);
    } catch (error) {
      this.logger.warn(`Realtime connection authentication failed: ${error instanceof Error ? error.message : 'unknown'}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    this.logger.log(`[REALTIME-DISCONNECTED] socketId=${client.id}`);
  }

  @SubscribeMessage('subscribe:admin-alerts')
  handleSubscribeAdminAlerts(@ConnectedSocket() client: AuthenticatedSocket) {
    if (client.data.role !== Role.SUPER_ADMIN) {
      return { status: 'error', message: 'Forbidden: SUPER_ADMIN role required for admin alerts topic.' };
    }
    void client.join('topic:admin:managed-alerts');
    return { status: 'success', subscribed: 'topic:admin:managed-alerts' };
  }

  @SubscribeMessage('subscribe:driver-reconciliation')
  handleSubscribeDriverReconciliation(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { driverUserId?: string },
  ) {
    const targetDriverId = data?.driverUserId ?? client.data.userId;
    if (client.data.role !== Role.SUPER_ADMIN && client.data.userId !== targetDriverId) {
      return { status: 'error', message: 'Forbidden: Cannot listen to another driver reconciliation queue.' };
    }
    const room = `topic:driver:reconciliation:${targetDriverId}`;
    void client.join(room);
    return { status: 'success', subscribed: room };
  }

  broadcastAdminAlert(payload: Record<string, any>): void {
    if (this.server) {
      this.server.to('topic:admin:managed-alerts').emit('admin:managed-alert', payload);
      this.server.to('role:SUPER_ADMIN').emit('admin:managed-alert', payload);
    }
  }

  sendToDriver(driverUserId: string, payload: Record<string, any>): void {
    if (this.server) {
      this.server.to(`topic:driver:reconciliation:${driverUserId}`).emit('driver:reconciliation-signal', payload);
      this.server.to(`user:${driverUserId}`).emit('driver:reconciliation-signal', payload);
    }
  }
}
