import {
  BusinessTier,
  OrderOrigin,
  OrderStatus,
  PackagingUnit,
  PrismaClient,
  StandardPricingProfileType,
  SystemUnitCategory,
  UserRole,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

const SEED_IDS = {
  users: {
    superAdmin: '00000000-0000-4000-8000-000000000001',
    wholesaler: '00000000-0000-4000-8000-000000000002',
    hybridMerchant: '00000000-0000-4000-8000-000000000003',
    retailer: '00000000-0000-4000-8000-000000000004',
    driver: '00000000-0000-4000-8000-000000000005',
    consumer: '00000000-0000-4000-8000-000000000006',
  },
  businesses: {
    kariakooHub: '11111111-1111-4111-8111-000000000001',
    ilalaHybrid: '11111111-1111-4111-8111-000000000002',
    kivuleDuka: '11111111-1111-4111-8111-000000000003',
  },
  catalog: {
    sugar: '22222222-2222-4222-8222-000000000001',
    oil: '22222222-2222-4222-8222-000000000002',
    flour: '22222222-2222-4222-8222-000000000003',
    rice: '22222222-2222-4222-8222-000000000004',
  },
  orders: {
    sampleDispatched: '33333333-3333-4333-8333-000000000001',
    samplePlacedManaged: '33333333-3333-4333-8333-000000000002',
  },
};

async function hashArgon2id(secret: string): Promise<string> {
  return argon2.hash(secret, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
}

async function main() {
  console.log('[SEED] Starting idempotent SokoKuu TZ database seed...');

  const [adminPasswordHash, standardPasswordHash, buyerPinHash, driverPinHash] = await Promise.all([
    hashArgon2id('Admin@2026'),
    hashArgon2id('Soko@2026'),
    hashArgon2id('1234'),
    hashArgon2id('5678'),
  ]);

  // 1. Users
  const seedUsers: Array<{
    id: string;
    phoneE164: string;
    fullName: string;
    role: UserRole;
    passwordHash: string;
    preferredLocale: string;
  }> = [
    {
      id: SEED_IDS.users.superAdmin,
      phoneE164: '+255700000001',
      fullName: 'Amina Msimamizi (Super Admin)',
      role: UserRole.SUPER_ADMIN,
      passwordHash: adminPasswordHash,
      preferredLocale: 'sw',
    },
    {
      id: SEED_IDS.users.wholesaler,
      phoneE164: '+255712000001',
      fullName: 'Juma Kariakoo (Kariakoo Bulk Hub)',
      role: UserRole.WHOLESALER,
      passwordHash: standardPasswordHash,
      preferredLocale: 'sw',
    },
    {
      id: SEED_IDS.users.hybridMerchant,
      phoneE164: '+255713000001',
      fullName: 'Neema Ilala (Ilala Hybrid Mart)',
      role: UserRole.RETAILER,
      passwordHash: standardPasswordHash,
      preferredLocale: 'sw',
    },
    {
      id: SEED_IDS.users.retailer,
      phoneE164: '+255714000001',
      fullName: 'Baraka Kivule (Kivule Retail Duka)',
      role: UserRole.RETAILER,
      passwordHash: standardPasswordHash,
      preferredLocale: 'sw',
    },
    {
      id: SEED_IDS.users.driver,
      phoneE164: '+255715000001',
      fullName: 'Musa Boda (Delivery Driver)',
      role: UserRole.DRIVER,
      passwordHash: standardPasswordHash,
      preferredLocale: 'sw',
    },
    {
      id: SEED_IDS.users.consumer,
      phoneE164: '+255716000001',
      fullName: 'Zainab Mnunuzi (End Consumer)',
      role: UserRole.CONSUMER,
      passwordHash: standardPasswordHash,
      preferredLocale: 'sw',
    },
  ];

  for (const u of seedUsers) {
    await prisma.user.upsert({
      where: { phoneE164: u.phoneE164 },
      update: {
        fullName: u.fullName,
        role: u.role,
        passwordHash: u.passwordHash,
        isActive: true,
      },
      create: {
        id: u.id,
        phoneE164: u.phoneE164,
        fullName: u.fullName,
        role: u.role,
        passwordHash: u.passwordHash,
        preferredLocale: u.preferredLocale,
        smsHmacSecret: randomBytes(32).toString('hex'),
        isActive: true,
      },
    });
  }

  const userRows = await prisma.user.findMany({
    where: { phoneE164: { in: seedUsers.map((u) => u.phoneE164) } },
    select: { id: true, phoneE164: true },
  });
  const userIdByPhone = new Map(userRows.map((u) => [u.phoneE164, u.id]));

  // 2. Business Profiles (with PostGIS location)
  const seedBusinesses: Array<{
    id: string;
    ownerPhone: string;
    smsShortCode: string;
    businessName: string;
    tier: BusinessTier;
    streetAddress: string;
    ward: string;
    district: string;
    latitude: number;
    longitude: number;
    isPlatformManaged: boolean;
    geospatialMapEnabled: boolean;
  }> = [
    {
      id: SEED_IDS.businesses.kariakooHub,
      ownerPhone: '+255712000001',
      smsShortCode: 'SK101',
      businessName: 'Kariakoo Bulk Hub',
      tier: BusinessTier.WHOLESALE_HUB,
      streetAddress: 'Msimbazi & Uhuru Street, Plot 14',
      ward: 'Kariakoo',
      district: 'Ilala',
      latitude: -6.81954,
      longitude: 39.27642,
      isPlatformManaged: true,
      geospatialMapEnabled: true,
    },
    {
      id: SEED_IDS.businesses.ilalaHybrid,
      ownerPhone: '+255713000001',
      smsShortCode: 'SK102',
      businessName: 'Ilala Hybrid Mart',
      tier: BusinessTier.HYBRID_STORE,
      streetAddress: 'Bungoni Road, Block 8',
      ward: 'Ilala',
      district: 'Ilala',
      latitude: -6.82711,
      longitude: 39.24891,
      isPlatformManaged: false,
      geospatialMapEnabled: true,
    },
    {
      id: SEED_IDS.businesses.kivuleDuka,
      ownerPhone: '+255714000001',
      smsShortCode: 'SK103',
      businessName: 'Kivule Retail Duka',
      tier: BusinessTier.RETAIL_DUKA,
      streetAddress: 'Kivule Kwa Msikitini',
      ward: 'Kivule',
      district: 'Ilala',
      latitude: -6.9125,
      longitude: 39.1852,
      isPlatformManaged: true,
      geospatialMapEnabled: false,
    },
  ];

  for (const b of seedBusinesses) {
    const ownerUserId = userIdByPhone.get(b.ownerPhone)!;
    await prisma.businessProfile.upsert({
      where: { smsShortCode: b.smsShortCode },
      update: {
        businessName: b.businessName,
        tier: b.tier,
        streetAddress: b.streetAddress,
        ward: b.ward,
        district: b.district,
        latitude: b.latitude,
        longitude: b.longitude,
        isOpen: true,
      },
      create: {
        id: b.id,
        ownerUserId,
        smsShortCode: b.smsShortCode,
        businessName: b.businessName,
        tier: b.tier,
        streetAddress: b.streetAddress,
        ward: b.ward,
        district: b.district,
        latitude: b.latitude,
        longitude: b.longitude,
        logoCdnUrl: 'https://ik.imagekit.io/sokokuutz/catalog/default-merchant.webp',
        isOpen: true,
        isPlatformManaged: b.isPlatformManaged,
        geospatialMapEnabled: b.geospatialMapEnabled,
      },
    });
  }

  await prisma.$executeRaw`
    UPDATE business_profiles
       SET location = ST_SetSRID(ST_MakePoint(longitude::double precision, latitude::double precision), 4326)::geography
     WHERE location IS NULL
  `;

  const bizRows = await prisma.businessProfile.findMany({
    where: { smsShortCode: { in: seedBusinesses.map((b) => b.smsShortCode) } },
    select: { id: true, smsShortCode: true },
  });
  const bizIdByCode = new Map(bizRows.map((b) => [b.smsShortCode, b.id]));
  const kariakooId = bizIdByCode.get('SK101')!;
  const ilalaHybridId = bizIdByCode.get('SK102')!;
  const kivuleDukaId = bizIdByCode.get('SK103')!;

  // 3. Canonical System Units
  const seedUnits: Array<{
    unitCode: string;
    category: SystemUnitCategory;
    nameSw: string;
    nameEn: string;
    abbreviation: string;
    allowFractional: boolean;
    baseReferenceCode: string;
  }> = [
    {
      unitCode: 'GUNIA',
      category: SystemUnitCategory.PACKAGING,
      nameSw: 'Gunia',
      nameEn: 'Sack / Gunia',
      abbreviation: 'gunia',
      allowFractional: false,
      baseReferenceCode: 'QUANTA_250G',
    },
    {
      unitCode: 'DEBE',
      category: SystemUnitCategory.PACKAGING,
      nameSw: 'Debe',
      nameEn: '20L Tin / Debe',
      abbreviation: 'debe',
      allowFractional: false,
      baseReferenceCode: 'QUANTA_250ML',
    },
    {
      unitCode: 'SADO',
      category: SystemUnitCategory.PACKAGING,
      nameSw: 'Sado',
      nameEn: 'Sado Basket (4 KG)',
      abbreviation: 'sado',
      allowFractional: false,
      baseReferenceCode: 'QUANTA_250G',
    },
    {
      unitCode: 'KILOGRAM',
      category: SystemUnitCategory.WEIGHT,
      nameSw: 'Kilo 1',
      nameEn: 'Kilogram',
      abbreviation: 'kg',
      allowFractional: true,
      baseReferenceCode: 'QUANTA_250G',
    },
    {
      unitCode: 'HALF_KILO',
      category: SystemUnitCategory.WEIGHT,
      nameSw: 'Nusu Kilo',
      nameEn: 'Half Kilogram',
      abbreviation: '0.5kg',
      allowFractional: false,
      baseReferenceCode: 'QUANTA_250G',
    },
    {
      unitCode: 'QUARTER_KILO',
      category: SystemUnitCategory.WEIGHT,
      nameSw: 'Robo Kilo (Quanta)',
      nameEn: 'Quarter Kilo (Quanta)',
      abbreviation: 'Q',
      allowFractional: false,
      baseReferenceCode: 'QUANTA_250G',
    },
    {
      unitCode: 'LITRE',
      category: SystemUnitCategory.VOLUME,
      nameSw: 'Lita 1',
      nameEn: 'Litre',
      abbreviation: 'L',
      allowFractional: true,
      baseReferenceCode: 'QUANTA_250ML',
    },
    {
      unitCode: 'MILLILITRE',
      category: SystemUnitCategory.VOLUME,
      nameSw: 'Mililita 250',
      nameEn: 'Quarter Litre (250mL)',
      abbreviation: 'mL',
      allowFractional: false,
      baseReferenceCode: 'QUANTA_250ML',
    },
    {
      unitCode: 'BOX',
      category: SystemUnitCategory.PACKAGING,
      nameSw: 'Boksi / Katoni',
      nameEn: 'Box / Carton',
      abbreviation: 'box',
      allowFractional: false,
      baseReferenceCode: 'QUANTA_250G',
    },
    {
      unitCode: 'PACK',
      category: SystemUnitCategory.PACKAGING,
      nameSw: 'Pakiti',
      nameEn: 'Pack',
      abbreviation: 'pk',
      allowFractional: false,
      baseReferenceCode: 'QUANTA_250G',
    },
  ];

  for (const unit of seedUnits) {
    await prisma.systemUnit.upsert({
      where: { unitCode: unit.unitCode },
      update: {
        category: unit.category,
        nameSw: unit.nameSw,
        nameEn: unit.nameEn,
        abbreviation: unit.abbreviation,
        allowFractional: unit.allowFractional,
        baseReferenceCode: unit.baseReferenceCode,
        isActive: true,
      },
      create: unit,
    });
  }

  const systemUnitRows = await prisma.systemUnit.findMany();
  const unitIdByCode = new Map(systemUnitRows.map((u) => [u.unitCode, u.id]));

  // 4. Categories & Global Catalog
  const seedCategories = [
    {
      categoryCode: 'NAFAKA_UNGA',
      nameSw: 'Nafaka & Unga',
      nameEn: 'Grains & Flours',
      imagekitFolderPath: '/sokokuutz/catalog/grains-flours',
    },
    {
      categoryCode: 'MAFUTA_KUPIKIA',
      nameSw: 'Mafuta ya Kupikia',
      nameEn: 'Cooking Oils',
      imagekitFolderPath: '/sokokuutz/catalog/cooking-oils',
    },
    {
      categoryCode: 'SUKARI_VINYWAJI',
      nameSw: 'Sukari & Vinywaji',
      nameEn: 'Sugar & Beverages',
      imagekitFolderPath: '/sokokuutz/catalog/sugar-beverages',
    },
  ];

  for (const cat of seedCategories) {
    await prisma.sokoCatalogCategory.upsert({
      where: { categoryCode: cat.categoryCode },
      update: {
        nameSw: cat.nameSw,
        nameEn: cat.nameEn,
        imagekitFolderPath: cat.imagekitFolderPath,
      },
      create: cat,
    });
  }

  const seedCatalogItems = [
    {
      id: SEED_IDS.catalog.sugar,
      canonicalSku: 'GC-KLM-SUGAR',
      fixedNameSw: 'Sukari ya Kahawia ya Kilombero (Standard)',
      fixedNameEn: 'Kilombero Brown Cane Sugar (Standard)',
      categoryCode: 'SUKARI_VINYWAJI',
      imagekitCdnUrl:
        'https://ik.imagekit.io/sokokuutz/tr:w-320,h-320,fo-auto,f-webp,q-80/catalog/sugar-beverages/kilombero_brown_sugar.webp',
      baseQuantumUnit: 'QUANTA_250G',
    },
    {
      id: SEED_IDS.catalog.oil,
      canonicalSku: 'GC-KOR-OIL',
      fixedNameSw: 'Mafuta ya Kupikia ya Korie (Standard)',
      fixedNameEn: 'Korie Cooking Oil (Standard)',
      categoryCode: 'MAFUTA_KUPIKIA',
      imagekitCdnUrl:
        'https://ik.imagekit.io/sokokuutz/tr:w-320,h-320,fo-auto,f-webp,q-80/catalog/cooking-oils/korie_cooking_oil.webp',
      baseQuantumUnit: 'QUANTA_250ML',
    },
    {
      id: SEED_IDS.catalog.flour,
      canonicalSku: 'GC-AZN-WHEAT',
      fixedNameSw: 'Unga wa Ngano Safi wa Azania (Standard)',
      fixedNameEn: 'Azania Refined Wheat Flour (Standard)',
      categoryCode: 'NAFAKA_UNGA',
      imagekitCdnUrl:
        'https://ik.imagekit.io/sokokuutz/tr:w-320,h-320,fo-auto,f-webp,q-80/catalog/grains-flours/azania_wheat_flour.webp',
      baseQuantumUnit: 'QUANTA_250G',
    },
    {
      id: SEED_IDS.catalog.rice,
      canonicalSku: 'GC-MBY-RICE',
      fixedNameSw: 'Mchele Mzuri wa Mbeya Grade A (Standard)',
      fixedNameEn: 'Mbeya Grade A Aromatic Rice (Standard)',
      categoryCode: 'NAFAKA_UNGA',
      imagekitCdnUrl:
        'https://ik.imagekit.io/sokokuutz/tr:w-320,h-320,fo-auto,f-webp,q-80/catalog/grains-flours/mbeya_super_rice.webp',
      baseQuantumUnit: 'QUANTA_250G',
    },
  ];

  for (const item of seedCatalogItems) {
    await prisma.sokoGlobalCatalog.upsert({
      where: { canonicalSku: item.canonicalSku },
      update: {
        fixedNameSw: item.fixedNameSw,
        fixedNameEn: item.fixedNameEn,
        categoryCode: item.categoryCode,
        staticImageUrl: item.imagekitCdnUrl,
        imagekitCdnUrl: item.imagekitCdnUrl,
        baseQuantumUnit: item.baseQuantumUnit,
        isActive: true,
      },
      create: {
        id: item.id,
        canonicalSku: item.canonicalSku,
        fixedNameSw: item.fixedNameSw,
        fixedNameEn: item.fixedNameEn,
        categoryCode: item.categoryCode,
        staticImageUrl: item.imagekitCdnUrl,
        imagekitCdnUrl: item.imagekitCdnUrl,
        baseQuantumUnit: item.baseQuantumUnit,
      },
    });
  }

  const catalogRows = await prisma.sokoGlobalCatalog.findMany();
  const catalogIdBySku = new Map(catalogRows.map((c) => [c.canonicalSku, c.id]));
  const sugarCatalogId = catalogIdBySku.get('GC-KLM-SUGAR')!;
  const oilCatalogId = catalogIdBySku.get('GC-KOR-OIL')!;
  const flourCatalogId = catalogIdBySku.get('GC-AZN-WHEAT')!;
  const riceCatalogId = catalogIdBySku.get('GC-MBY-RICE')!;

  // 5. Product-Specific Units & Versioned Standard Pricing Profiles
  const adminId = userIdByPhone.get('+255700000001')!;
  const retailProfile = await prisma.standardPricingProfile.upsert({
    where: { profileCode: 'RETAIL_STD_DEFAULT' },
    update: { nameSw: 'Bei Kuu ya Rejareja', nameEn: 'Standard Retail Pricing', isActive: true },
    create: {
      profileCode: 'RETAIL_STD_DEFAULT',
      profileType: StandardPricingProfileType.RETAIL,
      nameSw: 'Bei Kuu ya Rejareja',
      nameEn: 'Standard Retail Pricing',
      createdByAdminId: adminId,
    },
  });

  const wholesaleProfile = await prisma.standardPricingProfile.upsert({
    where: { profileCode: 'WHOLESALE_STD_DEFAULT' },
    update: { nameSw: 'Bei Kuu ya Jumla', nameEn: 'Standard Wholesale Pricing', isActive: true },
    create: {
      profileCode: 'WHOLESALE_STD_DEFAULT',
      profileType: StandardPricingProfileType.WHOLESALE,
      nameSw: 'Bei Kuu ya Jumla',
      nameEn: 'Standard Wholesale Pricing',
      createdByAdminId: adminId,
    },
  });

  const unitSpecs: Array<{
    globalCatalogId: string;
    unitCode: string;
    quarterQuantaPerUnit: number;
    displayLabelSw: string;
    displayLabelEn: string;
    isWholesaleUnit: boolean;
    retailStdTzs: number;
    wholesaleStdTzs: number;
  }> = [
    {
      globalCatalogId: sugarCatalogId,
      unitCode: 'GUNIA',
      quarterQuantaPerUnit: 200,
      displayLabelSw: 'Gunia 50 KG',
      displayLabelEn: '50 KG Sack',
      isWholesaleUnit: true,
      retailStdTzs: 155000,
      wholesaleStdTzs: 148000,
    },
    {
      globalCatalogId: sugarCatalogId,
      unitCode: 'KILOGRAM',
      quarterQuantaPerUnit: 4,
      displayLabelSw: 'Kilo 1',
      displayLabelEn: '1 KG',
      isWholesaleUnit: false,
      retailStdTzs: 3400,
      wholesaleStdTzs: 3100,
    },
    {
      globalCatalogId: sugarCatalogId,
      unitCode: 'QUARTER_KILO',
      quarterQuantaPerUnit: 1,
      displayLabelSw: 'Robo 250g',
      displayLabelEn: 'Quarter Kilo (250g)',
      isWholesaleUnit: false,
      retailStdTzs: 900,
      wholesaleStdTzs: 800,
    },
    {
      globalCatalogId: oilCatalogId,
      unitCode: 'DEBE',
      quarterQuantaPerUnit: 80,
      displayLabelSw: 'Debe 20 Lita',
      displayLabelEn: '20L Tin (Debe)',
      isWholesaleUnit: true,
      retailStdTzs: 78000,
      wholesaleStdTzs: 74000,
    },
    {
      globalCatalogId: oilCatalogId,
      unitCode: 'LITRE',
      quarterQuantaPerUnit: 4,
      displayLabelSw: 'Lita 1',
      displayLabelEn: '1 Litre',
      isWholesaleUnit: false,
      retailStdTzs: 4200,
      wholesaleStdTzs: 3900,
    },
    {
      globalCatalogId: flourCatalogId,
      unitCode: 'GUNIA',
      quarterQuantaPerUnit: 100,
      displayLabelSw: 'Mfuko 25 KG',
      displayLabelEn: '25 KG Bag',
      isWholesaleUnit: true,
      retailStdTzs: 54000,
      wholesaleStdTzs: 50000,
    },
    {
      globalCatalogId: flourCatalogId,
      unitCode: 'KILOGRAM',
      quarterQuantaPerUnit: 4,
      displayLabelSw: 'Kilo 1',
      displayLabelEn: '1 KG',
      isWholesaleUnit: false,
      retailStdTzs: 2400,
      wholesaleStdTzs: 2200,
    },
    {
      globalCatalogId: riceCatalogId,
      unitCode: 'GUNIA',
      quarterQuantaPerUnit: 200,
      displayLabelSw: 'Gunia 50 KG',
      displayLabelEn: '50 KG Sack',
      isWholesaleUnit: true,
      retailStdTzs: 165000,
      wholesaleStdTzs: 156000,
    },
    {
      globalCatalogId: riceCatalogId,
      unitCode: 'SADO',
      quarterQuantaPerUnit: 16,
      displayLabelSw: 'Sado (4 KG)',
      displayLabelEn: 'Sado (4 KG)',
      isWholesaleUnit: false,
      retailStdTzs: 13800,
      wholesaleStdTzs: 12900,
    },
    {
      globalCatalogId: riceCatalogId,
      unitCode: 'KILOGRAM',
      quarterQuantaPerUnit: 4,
      displayLabelSw: 'Kilo 1',
      displayLabelEn: '1 KG',
      isWholesaleUnit: false,
      retailStdTzs: 3600,
      wholesaleStdTzs: 3300,
    },
  ];

  const firstUnitByCatalog = new Map<string, { unitId: string; priceId: string; retailTzs: number }>();

  for (const spec of unitSpecs) {
    const systemUnitId = unitIdByCode.get(spec.unitCode)!;
    const productUnit = await prisma.globalProductUnit.upsert({
      where: {
        globalCatalogId_systemUnitId: {
          globalCatalogId: spec.globalCatalogId,
          systemUnitId,
        },
      },
      update: {
        quarterQuantaPerUnit: spec.quarterQuantaPerUnit,
        displayLabelSw: spec.displayLabelSw,
        displayLabelEn: spec.displayLabelEn,
        isWholesaleUnit: spec.isWholesaleUnit,
        isActive: true,
      },
      create: {
        globalCatalogId: spec.globalCatalogId,
        systemUnitId,
        quarterQuantaPerUnit: spec.quarterQuantaPerUnit,
        displayLabelSw: spec.displayLabelSw,
        displayLabelEn: spec.displayLabelEn,
        isWholesaleUnit: spec.isWholesaleUnit,
      },
    });

    const existingRetailPrice = await prisma.globalCatalogStandardPrice.findFirst({
      where: {
        globalCatalogId: spec.globalCatalogId,
        globalProductUnitId: productUnit.id,
        profileType: StandardPricingProfileType.RETAIL,
        isActive: true,
      },
    });

    const retailPriceRow =
      existingRetailPrice ??
      (await prisma.globalCatalogStandardPrice.create({
        data: {
          globalCatalogId: spec.globalCatalogId,
          globalProductUnitId: productUnit.id,
          pricingProfileId: retailProfile.id,
          profileType: StandardPricingProfileType.RETAIL,
          version: 1,
          minQty: 1,
          maxQty: 4,
          standardPriceTzs: BigInt(spec.retailStdTzs),
          createdByAdminId: adminId,
        },
      }));

    const existingWholesalePrice = await prisma.globalCatalogStandardPrice.findFirst({
      where: {
        globalCatalogId: spec.globalCatalogId,
        globalProductUnitId: productUnit.id,
        profileType: StandardPricingProfileType.WHOLESALE,
        isActive: true,
      },
    });

    if (!existingWholesalePrice) {
      await prisma.globalCatalogStandardPrice.create({
        data: {
          globalCatalogId: spec.globalCatalogId,
          globalProductUnitId: productUnit.id,
          pricingProfileId: wholesaleProfile.id,
          profileType: StandardPricingProfileType.WHOLESALE,
          version: 1,
          minQty: 5,
          maxQty: null,
          standardPriceTzs: BigInt(spec.wholesaleStdTzs),
          createdByAdminId: adminId,
        },
      });
    }

    if (!spec.isWholesaleUnit && !firstUnitByCatalog.has(spec.globalCatalogId)) {
      firstUnitByCatalog.set(spec.globalCatalogId, {
        unitId: productUnit.id,
        priceId: retailPriceRow.id,
        retailTzs: spec.retailStdTzs,
      });
    }
  }

  // 6. Initial Wholesaler, Hybrid & Retail Active Products + Price Tiers
  const merchantProductDefs = [
    {
      sellerBusinessId: kariakooId,
      globalCatalogId: sugarCatalogId,
      smsItemCode: 'P01',
      nameSw: 'Sukari ya Kilombero (Kariakoo Bulk)',
      nameEn: 'Kilombero Brown Sugar (Bulk)',
      cartonPriceTzs: 148000,
      dozenPriceTzs: 36000,
      packPriceTzs: 14500,
      unitPriceTzs: 3100,
      baseQuarterQuantaStock: 600,
      sealedBulkPackagesStock: 25,
      sealedParentUnitType: PackagingUnit.SACK_50KG,
      quantaPerSealedPackage: 200,
      wholesaleMinUnitsThreshold: 1,
      tiers: [
        { unitType: PackagingUnit.SACK_50KG, quarterQuantaPerUnit: 200, priceTzs: 148000, isWholesaleTier: true },
        { unitType: PackagingUnit.SACK_25KG, quarterQuantaPerUnit: 100, priceTzs: 75000, isWholesaleTier: true },
      ],
    },
    {
      sellerBusinessId: kariakooId,
      globalCatalogId: oilCatalogId,
      smsItemCode: 'P02',
      nameSw: 'Mafuta ya Korie 20L (Jumla)',
      nameEn: 'Korie Cooking Oil 20L (Wholesale)',
      cartonPriceTzs: 74000,
      dozenPriceTzs: 44000,
      packPriceTzs: 15000,
      unitPriceTzs: 3900,
      baseQuarterQuantaStock: 320,
      sealedBulkPackagesStock: 18,
      sealedParentUnitType: PackagingUnit.CARTON,
      quantaPerSealedPackage: 80,
      wholesaleMinUnitsThreshold: 1,
      tiers: [
        { unitType: PackagingUnit.CARTON, quarterQuantaPerUnit: 80, priceTzs: 74000, isWholesaleTier: true },
        { unitType: PackagingUnit.SINGLE_KILO_LITRE, quarterQuantaPerUnit: 4, priceTzs: 3900, isWholesaleTier: true },
      ],
    },
    {
      sellerBusinessId: kariakooId,
      globalCatalogId: flourCatalogId,
      smsItemCode: 'P03',
      nameSw: 'Unga wa Azania 25KG (Jumla)',
      nameEn: 'Azania Wheat Flour 25KG (Wholesale)',
      cartonPriceTzs: 50000,
      dozenPriceTzs: 26000,
      packPriceTzs: 11000,
      unitPriceTzs: 2200,
      baseQuarterQuantaStock: 400,
      sealedBulkPackagesStock: 30,
      sealedParentUnitType: PackagingUnit.SACK_25KG,
      quantaPerSealedPackage: 100,
      wholesaleMinUnitsThreshold: 1,
      tiers: [
        { unitType: PackagingUnit.SACK_25KG, quarterQuantaPerUnit: 100, priceTzs: 50000, isWholesaleTier: true },
      ],
    },
    {
      sellerBusinessId: kariakooId,
      globalCatalogId: riceCatalogId,
      smsItemCode: 'P04',
      nameSw: 'Mchele wa Mbeya Grade A (Jumla)',
      nameEn: 'Mbeya Super Rice Grade A (Wholesale)',
      cartonPriceTzs: 156000,
      dozenPriceTzs: 39000,
      packPriceTzs: 13200,
      unitPriceTzs: 3300,
      baseQuarterQuantaStock: 480,
      sealedBulkPackagesStock: 20,
      sealedParentUnitType: PackagingUnit.SACK_50KG,
      quantaPerSealedPackage: 200,
      wholesaleMinUnitsThreshold: 1,
      tiers: [
        { unitType: PackagingUnit.SACK_50KG, quarterQuantaPerUnit: 200, priceTzs: 156000, isWholesaleTier: true },
      ],
    },
    {
      sellerBusinessId: ilalaHybridId,
      globalCatalogId: sugarCatalogId,
      smsItemCode: 'H01',
      nameSw: 'Sukari ya Kilombero (Ilala Hybrid)',
      nameEn: 'Kilombero Sugar (Ilala Hybrid)',
      cartonPriceTzs: 152000,
      dozenPriceTzs: 39600,
      packPriceTzs: 16500,
      unitPriceTzs: 3400,
      baseQuarterQuantaStock: 120,
      sealedBulkPackagesStock: 8,
      sealedParentUnitType: PackagingUnit.SACK_50KG,
      quantaPerSealedPackage: 200,
      wholesaleMinUnitsThreshold: 1,
      tiers: [
        { unitType: PackagingUnit.SINGLE_KILO_LITRE, quarterQuantaPerUnit: 4, priceTzs: 3400, isWholesaleTier: false },
        { unitType: PackagingUnit.HALF_KILO_LITRE, quarterQuantaPerUnit: 2, priceTzs: 1750, isWholesaleTier: false },
        { unitType: PackagingUnit.QUARTER_KILO_LITRE, quarterQuantaPerUnit: 1, priceTzs: 900, isWholesaleTier: false },
        { unitType: PackagingUnit.SACK_50KG, quarterQuantaPerUnit: 200, priceTzs: 152000, isWholesaleTier: true },
      ],
    },
    {
      sellerBusinessId: kivuleDukaId,
      globalCatalogId: sugarCatalogId,
      smsItemCode: 'D01',
      nameSw: 'Sukari ya Kilombero (Rejareja)',
      nameEn: 'Kilombero Brown Sugar (Retail)',
      cartonPriceTzs: 155000,
      dozenPriceTzs: 40800,
      packPriceTzs: 17000,
      unitPriceTzs: 3400,
      baseQuarterQuantaStock: 84,
      sealedBulkPackagesStock: 2,
      sealedParentUnitType: PackagingUnit.SACK_50KG,
      quantaPerSealedPackage: 200,
      wholesaleMinUnitsThreshold: 1,
      tiers: [
        { unitType: PackagingUnit.SINGLE_KILO_LITRE, quarterQuantaPerUnit: 4, priceTzs: 3400, isWholesaleTier: false },
        { unitType: PackagingUnit.HALF_KILO_LITRE, quarterQuantaPerUnit: 2, priceTzs: 1750, isWholesaleTier: false },
        { unitType: PackagingUnit.QUARTER_KILO_LITRE, quarterQuantaPerUnit: 1, priceTzs: 900, isWholesaleTier: false },
      ],
    },
    {
      sellerBusinessId: kivuleDukaId,
      globalCatalogId: oilCatalogId,
      smsItemCode: 'D02',
      nameSw: 'Mafuta ya Korie (Rejareja)',
      nameEn: 'Korie Cooking Oil (Retail)',
      cartonPriceTzs: 78000,
      dozenPriceTzs: 48000,
      packPriceTzs: 16800,
      unitPriceTzs: 4200,
      baseQuarterQuantaStock: 64,
      sealedBulkPackagesStock: 1,
      sealedParentUnitType: PackagingUnit.CARTON,
      quantaPerSealedPackage: 80,
      wholesaleMinUnitsThreshold: 1,
      tiers: [
        { unitType: PackagingUnit.SINGLE_KILO_LITRE, quarterQuantaPerUnit: 4, priceTzs: 4200, isWholesaleTier: false },
        { unitType: PackagingUnit.HALF_KILO_LITRE, quarterQuantaPerUnit: 2, priceTzs: 2150, isWholesaleTier: false },
        { unitType: PackagingUnit.QUARTER_KILO_LITRE, quarterQuantaPerUnit: 1, priceTzs: 1100, isWholesaleTier: false },
      ],
    },
    {
      sellerBusinessId: kivuleDukaId,
      globalCatalogId: flourCatalogId,
      smsItemCode: 'D03',
      nameSw: 'Unga wa Azania (Rejareja)',
      nameEn: 'Azania Wheat Flour (Retail)',
      cartonPriceTzs: 54000,
      dozenPriceTzs: 28800,
      packPriceTzs: 12000,
      unitPriceTzs: 2400,
      baseQuarterQuantaStock: 96,
      sealedBulkPackagesStock: 2,
      sealedParentUnitType: PackagingUnit.SACK_25KG,
      quantaPerSealedPackage: 100,
      wholesaleMinUnitsThreshold: 1,
      tiers: [
        { unitType: PackagingUnit.SINGLE_KILO_LITRE, quarterQuantaPerUnit: 4, priceTzs: 2400, isWholesaleTier: false },
        { unitType: PackagingUnit.HALF_KILO_LITRE, quarterQuantaPerUnit: 2, priceTzs: 1250, isWholesaleTier: false },
      ],
    },
  ];

  let sampleKariakooSugarProductId = '';

  for (const p of merchantProductDefs) {
    const product = await prisma.product.upsert({
      where: {
        sellerBusinessId_smsItemCode: {
          sellerBusinessId: p.sellerBusinessId,
          smsItemCode: p.smsItemCode,
        },
      },
      update: {
        nameSw: p.nameSw,
        nameEn: p.nameEn,
        unitPriceTzs: BigInt(p.unitPriceTzs),
        cartonPriceTzs: BigInt(p.cartonPriceTzs),
        isActive: true,
      },
      create: {
        sellerBusinessId: p.sellerBusinessId,
        globalCatalogId: p.globalCatalogId,
        smsItemCode: p.smsItemCode,
        nameSw: p.nameSw,
        nameEn: p.nameEn,
        cartonPriceTzs: BigInt(p.cartonPriceTzs),
        dozenPriceTzs: BigInt(p.dozenPriceTzs),
        packPriceTzs: BigInt(p.packPriceTzs),
        unitPriceTzs: BigInt(p.unitPriceTzs),
        baseQuarterQuantaStock: p.baseQuarterQuantaStock,
        sealedBulkPackagesStock: p.sealedBulkPackagesStock,
        sealedParentUnitType: p.sealedParentUnitType,
        quantaPerSealedPackage: p.quantaPerSealedPackage,
        wholesaleMinUnitsThreshold: p.wholesaleMinUnitsThreshold,
        lowStockThresholdQuanta: 20,
      },
    });

    if (p.sellerBusinessId === kariakooId && p.smsItemCode === 'P01') {
      sampleKariakooSugarProductId = product.id;
    }

    for (const t of p.tiers) {
      await prisma.productPriceTier.upsert({
        where: {
          productId_unitType_isWholesaleTier: {
            productId: product.id,
            unitType: t.unitType,
            isWholesaleTier: t.isWholesaleTier,
          },
        },
        update: {
          quarterQuantaPerUnit: t.quarterQuantaPerUnit,
          priceTzs: BigInt(t.priceTzs),
          isActive: true,
        },
        create: {
          productId: product.id,
          unitType: t.unitType,
          quarterQuantaPerUnit: t.quarterQuantaPerUnit,
          priceTzs: BigInt(t.priceTzs),
          isWholesaleTier: t.isWholesaleTier,
        },
      });
    }
  }

  // 7. Initial Merchant Cloned Products & Pricing Overrides
  for (const merchantId of [ilalaHybridId, kivuleDukaId]) {
    for (const catId of [sugarCatalogId, oilCatalogId, flourCatalogId]) {
      const stdMeta = firstUnitByCatalog.get(catId);
      const clone = await prisma.merchantClonedProduct.upsert({
        where: {
          retailerBusinessId_globalCatalogId: {
            retailerBusinessId: merchantId,
            globalCatalogId: catId,
          },
        },
        update: {},
        create: {
          retailerBusinessId: merchantId,
          globalCatalogId: catId,
          availableQuantaStock: 40,
          lowStockThresholdQuanta: 20,
          unitPriceTzs: BigInt(stdMeta?.retailTzs ?? 3400),
          inventoryValueTzs: BigInt(30000),
          lastBuyingPricePerQuantumTzs: BigInt(740),
          weightedAvgBuyingCostPerQuantumTzs: BigInt(750),
          buyingPriceEstablished: true,
          imagekitCdnUrl:
            catalogRows.find((c) => c.id === catId)?.imagekitCdnUrl ?? '',
        },
      });

      if (stdMeta) {
        await prisma.merchantUnitPricingOverride.upsert({
          where: {
            clonedProductId_globalProductUnitId: {
              clonedProductId: clone.id,
              globalProductUnitId: stdMeta.unitId,
            },
          },
          update: {},
          create: {
            clonedProductId: clone.id,
            businessId: merchantId,
            globalProductUnitId: stdMeta.unitId,
            standardPriceId: stdMeta.priceId,
            standardPriceVersion: 1,
            selectedStandardPriceTzs: BigInt(stdMeta.retailTzs),
            effectiveSellingPriceTzs: BigInt(stdMeta.retailTzs),
            isOverridden: false,
          },
        });
      }
    }
  }

  // 8. Sample Field Lead Prospect
  const agentId = userIdByPhone.get('+255712000001')!;
  const existingLead = await prisma.sokoLead.findUnique({
    where: { ownerPhoneE164: '+255754889310' },
  });
  if (!existingLead) {
    await prisma.$executeRaw`
      INSERT INTO soko_leads (
        shop_name,
        owner_name,
        owner_phone_e164,
        ward_name,
        business_tier,
        latitude,
        longitude,
        gps_accuracy_meters,
        location,
        status,
        version,
        captured_by_agent_id
      ) VALUES (
        'Msimbazi Fresh Depot',
        'Hassan Mbwambo',
        '+255754889310',
        'Kariakoo, Ilala',
        'WHOLESALE_HUB'::business_tier,
        -6.821100,
        39.274900,
        8,
        ST_SetSRID(ST_MakePoint(39.274900, -6.821100), 4326)::geography,
        'PROSPECT'::lead_status,
        1,
        ${agentId}::uuid
      )
    `;
  }

  // 9. Sample Active Order, Dual-PIN Ledger & Managed Helpdesk Trace (idempotent by orderRef)
  const retailerUserId = userIdByPhone.get('+255714000001')!;
  const driverUserId = userIdByPhone.get('+255715000001')!;

  const existingSampleDispatched = await prisma.order.findUnique({
    where: { orderRef: 'SK100001' },
  });
  if (!existingSampleDispatched && sampleKariakooSugarProductId) {
    await prisma.order.create({
      data: {
        id: SEED_IDS.orders.sampleDispatched,
        orderRef: 'SK100001',
        buyerUserId: retailerUserId,
        sellerBusinessId: kariakooId,
        driverUserId,
        status: OrderStatus.DISPATCHED,
        originChannel: OrderOrigin.PWA_ONLINE,
        routingTargetPipeline: 'SUPER_ADMIN_HELPDESK_PIPELINE',
        expectedTotalTzs: BigInt(148000),
        paymentMethod: 'CASH',
        dispatchedAt: new Date(),
        items: {
          create: {
            productId: sampleKariakooSugarProductId,
            unitType: PackagingUnit.SACK_50KG,
            quantity: 1,
            baseUnitsTotal: 200,
            unitPriceTzs: BigInt(148000),
            lineTotalTzs: BigInt(148000),
            isWholesaleTierApplied: true,
          },
        },
        cashLedger: {
          create: {
            driverUserId,
            buyerConfirmationPin: buyerPinHash,
            driverConfirmationPin: driverPinHash,
            expectedCashAmount: BigInt(148000),
            collectedCashAmount: BigInt(0),
            paymentMethod: 'CASH',
            verificationStatus: 'WAITING',
          },
        },
        auditTraces: {
          create: {
            orderRef8: 'SK100001',
            sellerBusinessId: kariakooId,
            isPlatformManagedSnapshot: true,
            routingOutputCode: 'ROUTED_PLATFORM_MANAGED_HELPDESK',
            targetPipeline: 'SUPER_ADMIN_HELPDESK_PIPELINE',
            helpdeskStatus: 'OPEN',
          },
        },
      },
    });
  }

  console.log('[SEED] SokoKuu TZ seed completed successfully.');
}

main()
  .catch((error) => {
    console.error('[SEED] Failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
