export interface PlatformDownload {
  label: string;
  url: string;
  platform: 'mac' | 'windows' | 'linux';
}

export interface DownloadConfig {
  hasVerifiedInstallers: boolean;
  version: string;
  statusBadge: string;
  statusMessage: string;
  ctaText: string;
  targetAnchor: string;
  githubUrl: string;
  installers?: {
    mac?: PlatformDownload;
    windows?: PlatformDownload;
  };
}

export const DOWNLOAD_CONFIG: DownloadConfig = {
  hasVerifiedInstallers: false,
  version: '0.1.1',
  statusBadge: 'Coming soon',
  statusMessage: 'macOS & Windows installers coming soon',
  ctaText: 'Get Idle',
  targetAnchor: '#download',
  githubUrl: 'https://github.com/idlebrowser/idle',
};
