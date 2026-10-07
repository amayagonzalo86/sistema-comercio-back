import { registerDecorator, ValidationOptions } from 'class-validator';
import { isValidCuit } from './argentina-id';
import { isValidIpOrCidr } from '../security/ip-allowlist';

/** Valida una CUIT/CUIL argentina (formato, prefijo y dígito verificador). */
export function IsCuit(validationOptions?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isCuit',
      target: target.constructor,
      propertyName: propertyName.toString(),
      options: {
        message: 'La CUIT/CUIL no es válida (verificá los 11 dígitos y el dígito verificador).',
        ...validationOptions,
      },
      validator: {
        validate: (value: unknown): boolean => isValidCuit(value),
      },
    });
  };
}

/** Valida una IP (v4/v6) o un rango CIDR. Usar con { each: true } para arreglos. */
export function IsIpOrCidr(validationOptions?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isIpOrCidr',
      target: target.constructor,
      propertyName: propertyName.toString(),
      options: {
        message: 'Cada valor debe ser una IP o un rango CIDR válido (ej: 190.2.10.4 o 10.0.0.0/24).',
        ...validationOptions,
      },
      validator: {
        validate: (value: unknown): boolean => isValidIpOrCidr(value),
      },
    });
  };
}
