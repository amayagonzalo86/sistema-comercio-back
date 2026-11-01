import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Vendedor IA por WhatsApp (módulo premium AI_SALES).
 * - ai_sales_settings: configuración por empresa (número de WhatsApp, token cifrado, sucursal, medios de pago).
 * - ai_conversations / ai_messages: conversaciones con clientes y mensajes (cliente, asistente, vendedor, consultas).
 * - sales_orders: origen del pedido, entrega/flete, forma de pago acordada y teléfono de contacto.
 */
export class AiSales1791000000038 implements MigrationInterface {
  name = 'AiSales1791000000038';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`ai_sales_settings\` (
        \`id\` varchar(36) NOT NULL,
        \`tenant_id\` varchar(36) NOT NULL,
        \`enabled\` tinyint NOT NULL DEFAULT 0,
        \`assistant_name\` varchar(60) NOT NULL DEFAULT 'Sofía',
        \`greeting\` varchar(500) NULL,
        \`store_info\` text NULL,
        \`branch_id\` varchar(36) NULL,
        \`order_user_id\` varchar(36) NULL,
        \`payment_methods\` varchar(200) NOT NULL DEFAULT 'CASH,BANK_TRANSFER,DEBIT_CARD,CREDIT_CARD',
        \`daily_message_limit\` int UNSIGNED NOT NULL DEFAULT 500,
        \`whatsapp_phone_number_id\` varchar(40) NULL,
        \`whatsapp_display_phone\` varchar(30) NULL,
        \`whatsapp_token_sealed\` text NULL,
        \`updated_by_user_id\` varchar(36) NULL,
        \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`UQ_ai_sales_settings_tenant\` (\`tenant_id\`),
        UNIQUE INDEX \`UQ_ai_sales_settings_phone_number\` (\`whatsapp_phone_number_id\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);
    await queryRunner.query(`
      CREATE TABLE \`ai_conversations\` (
        \`id\` varchar(36) NOT NULL,
        \`tenant_id\` varchar(36) NOT NULL,
        \`channel\` enum ('WHATSAPP', 'SIMULATOR') NOT NULL,
        \`contact_phone\` varchar(30) NOT NULL,
        \`contact_name\` varchar(150) NULL,
        \`customer_person_id\` varchar(36) NULL,
        \`status\` enum ('ACTIVE', 'ORDER_PLACED', 'HANDOFF', 'CLOSED') NOT NULL DEFAULT 'ACTIVE',
        \`sales_order_id\` varchar(36) NULL,
        \`handoff_reason\` varchar(300) NULL,
        \`processing_until\` timestamp(6) NULL,
        \`last_message_at\` timestamp(6) NOT NULL,
        \`created_by_user_id\` varchar(36) NULL,
        \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX \`IDX_ai_conversations_contact\` (\`tenant_id\`, \`channel\`, \`contact_phone\`, \`last_message_at\`),
        INDEX \`IDX_ai_conversations_status\` (\`tenant_id\`, \`status\`, \`last_message_at\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);
    await queryRunner.query(`
      CREATE TABLE \`ai_messages\` (
        \`id\` varchar(36) NOT NULL,
        \`tenant_id\` varchar(36) NOT NULL,
        \`conversation_id\` varchar(36) NOT NULL,
        \`role\` enum ('CUSTOMER', 'ASSISTANT', 'HUMAN', 'TOOL', 'SYSTEM') NOT NULL,
        \`content\` text NOT NULL,
        \`wa_message_id\` varchar(128) NULL,
        \`tool_name\` varchar(60) NULL,
        \`provider\` varchar(20) NULL,
        \`model\` varchar(80) NULL,
        \`input_tokens\` int UNSIGNED NOT NULL DEFAULT 0,
        \`output_tokens\` int UNSIGNED NOT NULL DEFAULT 0,
        \`processed\` tinyint NOT NULL DEFAULT 0,
        \`author_user_id\` varchar(36) NULL,
        \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        INDEX \`IDX_ai_messages_conversation\` (\`tenant_id\`, \`conversation_id\`, \`created_at\`),
        UNIQUE INDEX \`UQ_ai_messages_wa\` (\`tenant_id\`, \`wa_message_id\`),
        INDEX \`IDX_ai_messages_daily\` (\`tenant_id\`, \`role\`, \`created_at\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);
    await queryRunner.query("ALTER TABLE `sales_orders` ADD `source` varchar(20) NOT NULL DEFAULT 'POS'");
    await queryRunner.query('ALTER TABLE `sales_orders` ADD `delivery_notes` varchar(500) NULL');
    await queryRunner.query('ALTER TABLE `sales_orders` ADD `payment_preference` varchar(200) NULL');
    await queryRunner.query('ALTER TABLE `sales_orders` ADD `contact_phone` varchar(30) NULL');
    // La empresa de la plataforma tiene todos los módulos (para probar y dar soporte); el resto lo activa el operador.
    await queryRunner.query(
      `INSERT IGNORE INTO tenant_modules (id, tenant_id, module, enabled, notes)
       SELECT UUID(), t.id, 'AI_SALES', 1, 'Empresa de la plataforma: todos los módulos.' FROM tenants t WHERE t.slug = 'plataforma'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM tenant_modules WHERE module = 'AI_SALES'");
    await queryRunner.query('ALTER TABLE `sales_orders` DROP COLUMN `contact_phone`');
    await queryRunner.query('ALTER TABLE `sales_orders` DROP COLUMN `payment_preference`');
    await queryRunner.query('ALTER TABLE `sales_orders` DROP COLUMN `delivery_notes`');
    await queryRunner.query('ALTER TABLE `sales_orders` DROP COLUMN `source`');
    await queryRunner.query('DROP TABLE `ai_messages`');
    await queryRunner.query('DROP TABLE `ai_conversations`');
    await queryRunner.query('DROP TABLE `ai_sales_settings`');
  }
}
