import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';
import { AI_PAYMENT_METHODS, AiPaymentMethod } from '../agent/ai-sales.tools';
import { AiConversationChannel, AiConversationStatus } from '../entities/ai-sales.entities';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() || null : value);

/** PUT /ai-sales/settings — configuración del vendedor IA (el token de WhatsApp se guarda cifrado y nunca se devuelve). */
export class UpdateAiSalesSettingsDto {
  @IsBoolean()
  enabled!: boolean;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  assistantName!: string;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(500)
  greeting?: string | null;

  /** Horarios, zonas y costos de envío/flete, retiro, políticas: lo que el asistente puede informar. */
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(4000)
  storeInfo?: string | null;

  /** Sucursal cuyos precios, stock y caja usa el asistente. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID('4')
  branchId?: string | null;

  /** Usuario de la empresa que figura como vendedor de los pedidos del asistente. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID('4')
  orderUserId?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(AI_PAYMENT_METHODS.length)
  @IsIn(AI_PAYMENT_METHODS, { each: true })
  paymentMethods!: AiPaymentMethod[];

  @IsInt()
  @Min(10)
  @Max(20000)
  dailyMessageLimit!: number;

  /** Phone number ID de la app de Meta (no es el número de teléfono). */
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_, value) => value !== null)
  @Matches(/^\d{5,40}$/, { message: 'El Phone number ID son solo dígitos (lo da Meta en WhatsApp > Configuración de la API).' })
  whatsappPhoneNumberId?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(30)
  whatsappDisplayPhone?: string | null;

  /** Token permanente de la API de WhatsApp. Solo se envía para cambiarlo. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(20)
  @MaxLength(1000)
  @Matches(/^\S+$/, { message: 'El token no puede tener espacios.' })
  whatsappAccessToken?: string;

  /** true para borrar el token guardado. */
  @IsOptional()
  @IsBoolean()
  clearAccessToken?: boolean;
}

export class AiConversationQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(AiConversationStatus)
  status?: AiConversationStatus;

  @IsOptional()
  @IsEnum(AiConversationChannel)
  channel?: AiConversationChannel;

  /** Teléfono o nombre del contacto. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  search?: string;
}

/** POST /ai-sales/conversations/:id/reply — responde una persona del local (toma la conversación). */
export class HumanReplyDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;
}

/** POST /ai-sales/conversations/:id/status */
export class ConversationStatusDto {
  @IsIn(['PAUSE', 'RESUME', 'CLOSE'])
  action!: 'PAUSE' | 'RESUME' | 'CLOSE';
}

/** POST /ai-sales/simulator — probar el asistente sin WhatsApp. */
export class SimulatorMessageDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;

  /** Seguir una conversación de prueba; sin esto se continúa la última abierta del usuario. */
  @IsOptional()
  @IsUUID('4')
  conversationId?: string;

  /** true para empezar una conversación de prueba nueva. */
  @IsOptional()
  @IsBoolean()
  restart?: boolean;
}

export class AiUsageQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}
