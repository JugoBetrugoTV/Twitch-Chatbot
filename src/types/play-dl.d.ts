/**
 * Type declarations for play-dl
 */

declare module 'play-dl' {
  export interface YouTubeSearchResult {
    type: 'video' | 'playlist' | 'channel';
    id?: string;
    title?: string;
    url: string;
    durationInSec?: number;
    durationRaw?: string;
    views?: number;
    uploadedAt?: string;
    thumbnails?: Array<{
      url: string;
      width: number;
      height: number;
    }>;
    channel?: {
      name?: string;
      url?: string;
      id?: string;
    };
    videoCount?: number;
    subscribers?: string;
    name?: string;
  }

  export interface SearchOptions {
    limit?: number;
    source?: {
      youtube?: 'video' | 'playlist' | 'channel';
    };
    fuzzy?: boolean;
    language?: string;
  }

  export interface VideoDetails {
    id?: string;
    title?: string;
    url: string;
    durationInSec?: number;
    durationRaw?: string;
    views?: number;
    uploadedAt?: string;
    description?: string;
    thumbnails?: Array<{
      url: string;
      width: number;
      height: number;
    }>;
    channel?: {
      name?: string;
      url?: string;
      id?: string;
    };
    likes?: number;
    live?: boolean;
    private?: boolean;
    tags?: string[];
  }

  export interface VideoInfo {
    video_details: VideoDetails;
    format?: any[];
    related_videos?: YouTubeSearchResult[];
  }

  export interface StreamOptions {
    quality?: number;
    htmldata?: boolean;
    precache?: number;
    discordPlayerCompatibility?: boolean;
  }

  export interface Stream {
    stream: import('stream').Readable;
    type: string;
    url?: string;
  }

  export function search(
    query: string,
    options?: SearchOptions
  ): Promise<YouTubeSearchResult[]>;

  export function video_basic_info(url: string): Promise<VideoInfo>;

  export function video_info(url: string): Promise<VideoInfo>;

  export function stream(url: string, options?: StreamOptions): Promise<Stream>;

  export function stream_from_info(info: VideoInfo, options?: StreamOptions): Promise<Stream>;

  export function validate(url: string): Promise<'yt_video' | 'yt_playlist' | 'sp_track' | 'sp_album' | 'sp_playlist' | 'so_track' | 'so_playlist' | 'dz_track' | 'dz_album' | 'dz_playlist' | 'search' | false>;

  export function yt_validate(url: string): 'video' | 'playlist' | 'search' | false;

  export function sp_validate(url: string): 'track' | 'album' | 'playlist' | false;

  export function so_validate(url: string): 'track' | 'playlist' | false;

  export function dz_validate(url: string): 'track' | 'album' | 'playlist' | false;

  export function is_expired(): boolean;

  export function refreshToken(): Promise<boolean>;

  export function setToken(options: {
    youtube?: {
      cookie?: string;
    };
    spotify?: {
      client_id?: string;
      client_secret?: string;
      refresh_token?: string;
      market?: string;
    };
    soundcloud?: {
      client_id?: string;
    };
  }): void;

  export function getFreeClientID(): Promise<string>;

  const play: {
    search: typeof search;
    video_basic_info: typeof video_basic_info;
    video_info: typeof video_info;
    stream: typeof stream;
    stream_from_info: typeof stream_from_info;
    validate: typeof validate;
    yt_validate: typeof yt_validate;
    sp_validate: typeof sp_validate;
    so_validate: typeof so_validate;
    dz_validate: typeof dz_validate;
    is_expired: typeof is_expired;
    refreshToken: typeof refreshToken;
    setToken: typeof setToken;
    getFreeClientID: typeof getFreeClientID;
  };

  export default play;
}
