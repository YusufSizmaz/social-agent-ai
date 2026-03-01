import { ContentType, Platform, Tone } from '../../config/constants.js';
import { logger } from '../../config/logger.js';
import type { ContentRequest, GeneratedContent, ProjectPlugin } from '../../types/index.js';
import { CatpetListener, type CatpetListing } from './listener.js';
import { buildCatpetPrompt } from './prompts.js';

export class CatpetPlugin implements ProjectPlugin {
  name = 'catpet';
  private listener = new CatpetListener();

  async init(): Promise<void> {
    await this.listener.init();
    logger.info('Catpet plugin initialized');
  }

  async poll(): Promise<ContentRequest[]> {
    const listings = await this.listener.pollNewListings();
    const requests: ContentRequest[] = [];

    for (const listing of listings) {
      // Twitter: always generate (TEXT or IMAGE)
      requests.push(this.listingToRequest(listing, Platform.TWITTER));

      // Instagram: only if listing has images (Instagram requires images)
      if (listing.imageUrls.length > 0) {
        requests.push(this.listingToRequest(listing, Platform.INSTAGRAM));
      }
    }

    return requests;
  }

  transform(content: GeneratedContent): GeneratedContent {
    if (!content.hashtags.some((h) => h.toLowerCase().includes('catpet'))) {
      content.hashtags.push('#CatPet');
    }
    return content;
  }

  getPrompt(request: ContentRequest): string {
    const context = request.context as {
      type: 'adoption' | 'lost' | 'awareness';
      animalType: string;
      animalName?: string;
      breed?: string;
      age?: string;
      location: string;
      description?: string;
    };

    return buildCatpetPrompt({
      type: context.type,
      animalType: context.animalType,
      animalName: context.animalName,
      breed: context.breed,
      age: context.age,
      location: context.location,
      description: context.description,
      platform: request.platform,
      contentType: request.contentType,
      tone: request.tone,
    });
  }

  async destroy(): Promise<void> {
    await this.listener.destroy();
    logger.info('Catpet plugin destroyed');
  }

  private listingToRequest(listing: CatpetListing, platform: Platform): ContentRequest {
    let contentType: ContentType;

    if (platform === Platform.INSTAGRAM) {
      contentType = ContentType.IMAGE;
    } else {
      contentType = listing.imageUrls.length > 0 ? ContentType.IMAGE : ContentType.TEXT;
    }

    return {
      projectId: 'catpet',
      platform,
      contentType,
      tone: listing.type === 'lost' ? Tone.URGENT : Tone.EMOTIONAL,
      prompt: '',
      context: {
        type: listing.type,
        animalType: listing.animalType,
        animalName: listing.animalName,
        breed: listing.breed,
        age: listing.age,
        location: listing.location,
        description: listing.description,
      },
      mediaUrls: listing.imageUrls,
    };
  }
}
