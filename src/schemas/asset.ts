import { z } from 'zod';
import { PaginationParams } from './common.js';
import { DetailLevelInput } from './record.js';

export const ListAssetsInput = PaginationParams.extend({
  detail_level: DetailLevelInput.optional(),
});

export const GetAssetInput = z.object({
  id: z.number().int().positive().describe('SWSD internal id for the asset-like record.'),
  detail_level: DetailLevelInput,
});

export type ListAssetsInputT = z.infer<typeof ListAssetsInput>;
export type GetAssetInputT = z.infer<typeof GetAssetInput>;
