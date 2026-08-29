import { PartialType } from '@nestjs/mapped-types';
import { CreateProductPriceListDto } from './create-product-price-list.dto';

export class UpdateProductPriceListDto extends PartialType(CreateProductPriceListDto) {}
