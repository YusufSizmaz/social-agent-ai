import postgres from 'postgres';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

export interface CatpetListing {
  id: string;
  type: 'adoption' | 'lost';
  animalType: string;
  animalName?: string;
  breed?: string;
  age?: string;
  location: string;
  description?: string;
  imageUrls: string[];
  createdAt: Date;
}

export class CatpetListener {
  private client: ReturnType<typeof postgres> | null = null;
  private lastPollTime: Date = new Date();

  async init(): Promise<void> {
    if (!env.CATPET_DATABASE_URL) {
      logger.warn('Catpet database URL not configured');
      return;
    }

    this.client = postgres(env.CATPET_DATABASE_URL);
    this.lastPollTime = new Date();
    logger.info('Catpet listener initialized');
  }

  async pollNewListings(): Promise<CatpetListing[]> {
    if (!this.client) return [];

    try {
      const rows = await this.client<Array<{
        id: string;
        type: string;
        animal_type: string;
        animal_name: string | null;
        breed: string | null;
        age: string | null;
        location: string;
        description: string | null;
        image_urls: string[];
        created_at: Date;
      }>>`
        SELECT id, type, animal_type, animal_name, breed, age, location, description, image_urls, created_at
        FROM listings
        WHERE created_at > ${this.lastPollTime}
          AND status = 'active'
        ORDER BY created_at ASC
        LIMIT 10
      `;

      if (rows.length > 0) {
        this.lastPollTime = rows[rows.length - 1]!.created_at;
      }

      return rows.map((row) => ({
        id: row.id,
        type: row.type as 'adoption' | 'lost',
        animalType: row.animal_type,
        animalName: row.animal_name ?? undefined,
        breed: row.breed ?? undefined,
        age: row.age ?? undefined,
        location: row.location,
        description: row.description ?? undefined,
        imageUrls: row.image_urls ?? [],
        createdAt: row.created_at,
      }));
    } catch (err) {
      logger.error('Catpet polling failed', { error: err instanceof Error ? err.message : String(err) });
      return [];
    }
  }

  async destroy(): Promise<void> {
    if (this.client) {
      await this.client.end();
      this.client = null;
    }
  }
}
