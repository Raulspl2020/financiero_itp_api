import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class GenerateInvoiceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(15)
  @IsNotEmpty()
  codPaquete: string;

  @IsNumber()
  @IsPositive()
  @IsNotEmpty()
  @IsOptional()
  @Transform(({ value }) => {
    return Number(value);
  })
  matriculaId?: number;

  @IsNumber()
  @IsPositive()
  @IsNotEmpty()
  @Transform(({ value }) => {
    return Number(value);
  })
  total: number;

  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(15)
  personaId: string;

  @IsBoolean()
  @IsNotEmpty()
  @Transform(({ value }) => {
    return Boolean(value);
  })
  isPagoOnline: boolean;

  @IsNumber()
  @IsPositive()
  @IsNotEmpty()
  @Transform(({ value }) => {
    return Number(value);
  })
  programaPersonaId: number;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  @Transform(({ value }) => {
    return Number(value);
  })
  cantidad?: number;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  @Transform(({ value }) => {
    return Number(value);
  })
  conceptoId?: number;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  descripcion?: string;
}
