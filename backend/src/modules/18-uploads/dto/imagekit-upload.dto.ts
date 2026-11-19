import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const SAFE_FOLDER_REGEX = /^\/[a-zA-Z0-9/_-]*$/;
const SAFE_FILE_NAME_REGEX = /^[a-zA-Z0-9._() -]+$/;

export class ImageKitSignatureDto {
  @ApiPropertyOptional({ example: '/sokokuu/supplier-listings' })
  @IsOptional()
  @IsString()
  @Matches(SAFE_FOLDER_REGEX, {
    message: 'folder must be an absolute ImageKit path using letters, numbers, /, _ or -',
  })
  @MaxLength(200)
  folder?: string;

  @ApiPropertyOptional({ example: 'mafuta-korie-20l.webp' })
  @IsOptional()
  @IsString()
  @Matches(SAFE_FILE_NAME_REGEX, {
    message: 'fileName contains unsupported characters',
  })
  @MaxLength(180)
  fileName?: string;
}
