import { mkdirSync, writeFileSync } from 'node:fs';
import { CustomProfileSchema } from '../src/config/customProfile.js';

mkdirSync('schemas', { recursive: true });
writeFileSync('schemas/swsd-profile.schema.json', JSON.stringify(CustomProfileSchema.toJSONSchema(), null, 2) + '\n');
