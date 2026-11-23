import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'crypto';
import { Role } from '@common/security/roles.enum';
import { ImageKitSignatureDto } from './dto/imagekit-upload.dto';

export interface ImageKitUploadSignature {
  publicKey: string;
  urlEndpoint: string;
  signature: string;
  expire: number;
  token: string;
  folder: string;
  fileName: string;
}

/**
 * Folders a role may write to. ImageKit's browser upload signature only covers
 * token + expire, so folder/fileName travel as unsigned form fields. We
 * therefore enforce the destination here, server-side, and derive the file
 * name from a random token so a caller cannot overwrite a known CDN object.
 */
const ROLE_FOLDERS: Record<Role, readonly string[]> = {
  [Role.SUPER_ADMIN]: [
    '/sokokuu/catalog',
    '/sokokuu/supplier-listings',
    '/merchants',
    '/sokokuu',
  ],
  [Role.SUPPLIER]: ['/sokokuu/supplier-listings', '/sokokuu'],
  [Role.WHOLESALER]: ['/merchants', '/sokokuu'],
  [Role.RETAILER]: ['/merchants', '/sokokuu'],
  [Role.CONSUMER]: ['/sokokuu'],
  [Role.DRIVER]: ['/sokokuu'],
  [Role.SALES_STAFF]: ['/sokokuu'],
};

@Injectable()
export class ImageKitUploadService {
  constructor(private readonly config: ConfigService) {}

  createSignature(dto: ImageKitSignatureDto, role: Role): ImageKitUploadSignature {
    const publicKey = this.config.get<string>('IMAGEKIT_PUBLIC_KEY');
    const privateKey = this.config.get<string>('IMAGEKIT_PRIVATE_KEY');
    const urlEndpoint = this.config.get<string>('IMAGEKIT_URL_ENDPOINT');

    if (!publicKey || !privateKey || !urlEndpoint) {
      throw new ServiceUnavailableException(
        'ImageKit credentials are not configured on the SokoKuu backend.',
      );
    }

    const allowed = ROLE_FOLDERS[role] ?? ['/sokokuu'];
    const requested = dto.folder?.trim() || '/sokokuu';
    if (!allowed.includes(requested)) {
      throw new ForbiddenException('Your role cannot upload images to this folder.');
    }

    const token = randomBytes(20).toString('hex');
    const expire = Math.floor(Date.now() / 1000) + 600;
    const folder = requested;
    // Random token is the leading path segment of the object name, so two
    // users can never target the same CDN key (no overwrite / cache poisoning).
    const fileName = `${token}-${dto.fileName?.trim() || 'upload.webp'}`;
    const signature = createHmac('sha1', privateKey)
      .update(`${token}${expire}`)
      .digest('hex');

    return {
      publicKey,
      urlEndpoint,
      signature,
      expire,
      token,
      folder,
      fileName,
    };
  }
}
