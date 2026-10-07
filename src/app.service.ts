import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface HealthStatus {
  status: 'ok';
  database: 'up';
  timestamp: string;
}

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  constructor(private readonly dataSource: DataSource) {}

  /** Chequeo liviano para el balanceador/plataforma: no expone versiones ni datos internos. */
  async health(): Promise<HealthStatus> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch (error) {
      this.logger.error(`Health check: base de datos no disponible: ${error instanceof Error ? error.message : String(error)}`);
      throw new ServiceUnavailableException('Servicio no disponible');
    }
    return { status: 'ok', database: 'up', timestamp: new Date().toISOString() };
  }
}
