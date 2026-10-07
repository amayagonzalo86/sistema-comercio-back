export enum TaxConditionEnum {
  RESPONSABLE_INSCRIPTO = 'RESPONSABLE_INSCRIPTO',
  MONOTRIBUTO = 'MONOTRIBUTO',
  EXENTO = 'EXENTO',
  CONSUMIDOR_FINAL = 'CONSUMIDOR_FINAL',
  NO_RESPONSABLE = 'NO_RESPONSABLE',
  SUJETO_NO_CATEGORIZADO = 'SUJETO_NO_CATEGORIZADO',
  CLIENTE_DEL_EXTERIOR = 'CLIENTE_DEL_EXTERIOR',
}

/** Condiciones que exigen identificar al receptor con CUIT. */
export const CUIT_REQUIRED_CONDITIONS: ReadonlySet<TaxConditionEnum> = new Set([
  TaxConditionEnum.RESPONSABLE_INSCRIPTO,
  TaxConditionEnum.MONOTRIBUTO,
  TaxConditionEnum.EXENTO,
]);

/** Convierte el código guardado en el perfil fiscal a la condición tipada; null si no es válido. */
export function parseTaxCondition(value: string | null | undefined): TaxConditionEnum | null {
  const normalized = (value ?? '').trim().toUpperCase();
  return (Object.values(TaxConditionEnum) as string[]).includes(normalized)
    ? (normalized as TaxConditionEnum)
    : null;
}

export enum VoucherTypeEnum {
  FACTURA_A = 1,
  NOTA_DEBITO_A = 2,
  NOTA_CREDITO_A = 3,
  FACTURA_B = 6,
  NOTA_DEBITO_B = 7,
  NOTA_CREDITO_B = 8,
  FACTURA_C = 11,
  NOTA_DEBITO_C = 12,
  NOTA_CREDITO_C = 13,
  FACTURA_M = 51,
  PRESUPUESTO_X = 999,
}

export enum IdentificationTypeEnum {
  CUIT = 80,
  CUIL = 86,
  DNI = 96,
  PASAPORTE = 94,
  CONSUMIDOR_FINAL = 99,
}