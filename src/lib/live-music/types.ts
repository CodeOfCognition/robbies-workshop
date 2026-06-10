export interface TopArtist {
  name: string;
  rank: number;
  msPlayed: number;
}

export interface LiveMusicVenue {
  id: string;
  name: string;
  city: string;
  stateCode: string;
  address?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
}

export interface LiveMusicEvent {
  id: string;
  name: string;
  url?: string;
  dateLabel: string;
  timeLabel?: string;
  sortDate: string;
  priceLabel: string;
  venue?: LiveMusicVenue;
  imageUrl?: string;
  attractionNames: string[];
  matchedArtists: string[];
  reason?: string;
}

export interface LiveMusicPayload {
  generatedAt: string;
  events: LiveMusicEvent[];
  venues: LiveMusicVenue[];
}

export interface ForYouPayload extends LiveMusicPayload {
  artists: TopArtist[];
  searchedArtists: TopArtist[];
}
