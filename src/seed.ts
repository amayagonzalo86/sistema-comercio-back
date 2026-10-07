import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AdminSeederService } from './database/seeders/admin-seeder.service';

async function bootstrap() {
    const logger = new Logger('SeederScript');
    const appContext = await NestFactory.createApplicationContext(AppModule);

    try {
        const seeder = appContext.get(AdminSeederService);
        await seeder.seed();
        logger.log('Proceso de sembrado finalizado correctamente.');
    } catch (error) {
        logger.error(`Error durante la ejecución del seeder: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    } finally {
        await appContext.close();
    }
}

void bootstrap();