import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Configuración del vendedor IA de una empresa (una fila por empresa). */
@Entity('ai_sales_settings')
@Index('UQ_ai_sales_settings_tenant', ['tenantId'], { unique: true })
@Index('UQ_ai_sales_settings_phone_number', ['whatsappPhoneNumberId'], { unique: true })
export class AiSalesSettingsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  /** El asistente responde (si está apagado, los mensajes quedan para un vendedor humano). */
  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({ name: 'assistant_name', type: 'varchar', length: 60, default: 'Sofía' })
  assistantName!: string;

  /** Saludo inicial (opcional). */
  @Column({ type: 'varchar', length: 500, nullable: true })
  greeting?: string | null;

  /** Información del comercio para el asistente: horarios, envíos y fletes, retiro, garantías… */
  @Column({ name: 'store_info', type: 'text', nullable: true })
  storeInfo?: string | null;

  /** Sucursal donde se arman y cobran los pedidos. */
  @Column({ name: 'branch_id', type: 'varchar', length: 36, nullable: true })
  branchId?: string | null;

  /** Empleado a cuyo nombre quedan los pedidos (aparece como vendedor). */
  @Column({ name: 'order_user_id', type: 'varchar', length: 36, nullable: true })
  orderUserId?: string | null;

  /** Medios de pago que puede ofrecer: "CASH,BANK_TRANSFER,DEBIT_CARD,CREDIT_CARD,QR,ACCOUNT". */
  @Column({ name: 'payment_methods', type: 'varchar', length: 200, default: 'CASH,BANK_TRANSFER,DEBIT_CARD,CREDIT_CARD' })
  paymentMethods!: string;

  /** Tope diario de respuestas del asistente (control de costos). */
  @Column({ name: 'daily_message_limit', type: 'int', unsigned: true, default: 500 })
  dailyMessageLimit!: number;

  /** Identificador del número en WhatsApp Cloud API (Meta). */
  @Column({ name: 'whatsapp_phone_number_id', type: 'varchar', length: 40, nullable: true })
  whatsappPhoneNumberId?: string | null;

  @Column({ name: 'whatsapp_display_phone', type: 'varchar', length: 30, nullable: true })
  whatsappDisplayPhone?: string | null;

  /** Token de acceso de Meta, cifrado (AES-256-GCM). Nunca se devuelve por la API. */
  @Column({ name: 'whatsapp_token_sealed', type: 'text', nullable: true, select: false })
  whatsappTokenSealed?: string | null;

  @Column({ name: 'updated_by_user_id', type: 'varchar', length: 36, nullable: true })
  updatedByUserId?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp', precision: 6 })
  updatedAt!: Date;
}

export enum AiConversationChannel {
  WHATSAPP = 'WHATSAPP',
  /** Prueba desde el panel (no envía mensajes de WhatsApp). */
  SIMULATOR = 'SIMULATOR',
}

export enum AiConversationStatus {
  /** El asistente está atendiendo. */
  ACTIVE = 'ACTIVE',
  /** Pedido confirmado y enviado a caja. */
  ORDER_PLACED = 'ORDER_PLACED',
  /** Derivada a un vendedor humano (el asistente no responde). */
  HANDOFF = 'HANDOFF',
  CLOSED = 'CLOSED',
}

@Entity('ai_conversations')
@Index('IDX_ai_conversations_contact', ['tenantId', 'channel', 'contactPhone', 'lastMessageAt'])
@Index('IDX_ai_conversations_status', ['tenantId', 'status', 'lastMessageAt'])
export class AiConversationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ type: 'enum', enum: AiConversationChannel })
  channel!: AiConversationChannel;

  /** Número de WhatsApp del cliente (wa_id, solo dígitos con código de país). */
  @Column({ name: 'contact_phone', type: 'varchar', length: 30 })
  contactPhone!: string;

  /** Nombre del perfil de WhatsApp. */
  @Column({ name: 'contact_name', type: 'varchar', length: 150, nullable: true })
  contactName?: string | null;

  @Column({ name: 'customer_person_id', type: 'varchar', length: 36, nullable: true })
  customerPersonId?: string | null;

  @Column({ type: 'enum', enum: AiConversationStatus, default: AiConversationStatus.ACTIVE })
  status!: AiConversationStatus;

  @Column({ name: 'sales_order_id', type: 'varchar', length: 36, nullable: true })
  salesOrderId?: string | null;

  @Column({ name: 'handoff_reason', type: 'varchar', length: 300, nullable: true })
  handoffReason?: string | null;

  /** Turno del asistente en curso (evita respuestas duplicadas si llegan mensajes seguidos). */
  @Column({ name: 'processing_until', type: 'timestamp', precision: 6, nullable: true })
  processingUntil?: Date | null;

  @Column({ name: 'last_message_at', type: 'timestamp', precision: 6 })
  lastMessageAt!: Date;

  @Column({ name: 'created_by_user_id', type: 'varchar', length: 36, nullable: true })
  createdByUserId?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp', precision: 6 })
  updatedAt!: Date;
}

export enum AiMessageRole {
  CUSTOMER = 'CUSTOMER',
  ASSISTANT = 'ASSISTANT',
  /** Respuesta escrita por un vendedor desde el panel. */
  HUMAN = 'HUMAN',
  /** Consulta del asistente al sistema (stock, precios, pedido): queda para revisar qué hizo. */
  TOOL = 'TOOL',
  SYSTEM = 'SYSTEM',
}

@Entity('ai_messages')
@Index('IDX_ai_messages_conversation', ['tenantId', 'conversationId', 'createdAt'])
@Index('UQ_ai_messages_wa', ['tenantId', 'waMessageId'], { unique: true })
@Index('IDX_ai_messages_daily', ['tenantId', 'role', 'createdAt'])
export class AiMessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'conversation_id', type: 'varchar', length: 36 })
  conversationId!: string;

  @Column({ type: 'enum', enum: AiMessageRole })
  role!: AiMessageRole;

  @Column({ type: 'text' })
  content!: string;

  /** Id del mensaje en WhatsApp (evita procesar dos veces el mismo mensaje). */
  @Column({ name: 'wa_message_id', type: 'varchar', length: 128, nullable: true })
  waMessageId?: string | null;

  @Column({ name: 'tool_name', type: 'varchar', length: 60, nullable: true })
  toolName?: string | null;

  /** Proveedor y modelo de IA que respondió (anthropic, openai, gemini). */
  @Column({ type: 'varchar', length: 20, nullable: true })
  provider?: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  model?: string | null;

  @Column({ name: 'input_tokens', type: 'int', unsigned: true, default: 0 })
  inputTokens!: number;

  @Column({ name: 'output_tokens', type: 'int', unsigned: true, default: 0 })
  outputTokens!: number;

  /** Mensajes del cliente: ya respondidos por el asistente. */
  @Column({ type: 'boolean', default: false })
  processed!: boolean;

  @Column({ name: 'author_user_id', type: 'varchar', length: 36, nullable: true })
  authorUserId?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;
}
