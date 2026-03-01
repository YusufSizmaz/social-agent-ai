import { Platform, type ContentType, type Tone } from '../../config/constants.js';

interface PromptParams {
  type: 'adoption' | 'lost' | 'awareness';
  animalType: string;
  animalName?: string;
  breed?: string;
  age?: string;
  location: string;
  description?: string;
  platform: Platform;
  contentType: ContentType;
  tone: Tone;
}

function getPlatformInstruction(platform: Platform): string {
  switch (platform) {
    case Platform.TWITTER:
      return `Platform kurallari:
- Metin 280 karakteri gecmemeli (hashtagler dahil)
- Kisa, vurucu ve net yaz
- En fazla 5 hashtag kullan`;
    case Platform.INSTAGRAM:
      return `Platform kurallari:
- Uzun ve detayli bir caption yaz (1000-2000 karakter)
- 15-20 hashtag kullan
- Emoji bol kullan
- Hikaye anlatir gibi yaz, duygusal baglanti kur
- Ilk cumle dikkat cekici olsun (feed'de gorulur)`;
    case Platform.YOUTUBE:
      return `Platform kurallari:
- Video baslik ve aciklama yaz
- SEO dostu hashtagler kullan (10-15 adet)
- Aciklamada detayli bilgi ver`;
    case Platform.TIKTOK:
      return `Platform kurallari:
- Kisa ve enerjik yaz
- Trend hashtagler kullan (5-10 adet)
- Gen-Z diline uygun, samimi yaz`;
  }
}

export function buildCatpetPrompt(params: PromptParams): string {
  const platformInstruction = getPlatformInstruction(params.platform);

  const baseInstruction = `Sen Turkiye'de hayvan haklari ve sahiplendirme konusunda uzman bir sosyal medya icerik ureticisisin.
Turkce yaz. Samimi, duygusal ve etkileyici bir dil kullan.
Platform: ${params.platform}
Icerik turu: ${params.contentType}
Ton: ${params.tone}

${platformInstruction}`;

  switch (params.type) {
    case 'adoption':
      return `${baseInstruction}

Asagidaki hayvan icin sahiplendirme ilani olustur:
- Hayvan turu: ${params.animalType}
${params.animalName ? `- Ismi: ${params.animalName}` : ''}
${params.breed ? `- Cinsi: ${params.breed}` : ''}
${params.age ? `- Yasi: ${params.age}` : ''}
- Konum: ${params.location}
${params.description ? `- Aciklama: ${params.description}` : ''}

Onemli kurallar:
- Sahiplendirme linkini veya iletisim bilgisini ekle deme, sadece metni yaz
- Duygusal ama abartisiz bir dil kullan
- Hayvanin ozelliklerini on plana cikar
- Uygun hashtagler ekle (#sahiplendonat, #sahiplen, #hayvanhaklari vb.)`;

    case 'lost':
      return `${baseInstruction}

Asagidaki kayip hayvan icin acil ilan olustur:
- Hayvan turu: ${params.animalType}
${params.animalName ? `- Ismi: ${params.animalName}` : ''}
${params.breed ? `- Cinsi: ${params.breed}` : ''}
- Kayip bolgesi: ${params.location}
${params.description ? `- Aciklama: ${params.description}` : ''}

Onemli kurallar:
- Aciliyet hissi olustur
- Paylasimi tesvik et
- Bolgede yasayanlara seslen
- Uygun hashtagler ekle (#kayıphayvan, #kayıp, #bulunsun vb.)`;

    case 'awareness':
      return `${baseInstruction}

Hayvan haklari ve sahiplendirme farkindalik icerigi olustur.
Konu: ${params.description ?? 'Genel hayvan haklari farkindaligi'}
Konum/Bolge: ${params.location}

Onemli kurallar:
- Egitici ve bilgilendirici ol
- Istatistik veya gercek veriler kullanabilirsin
- Harekete gecirici bir mesaj ver (sahiplen, dontme, bagis yap vb.)
- Uygun hashtagler ekle`;
  }
}
