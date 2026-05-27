"use client";

import {
  MediaController,
  MediaControlBar,
  MediaDurationDisplay,
  MediaPlayButton,
  MediaTimeDisplay,
  MediaTimeRange,
} from "media-chrome/react";
import type { ComponentProps, CSSProperties } from "react";
import { cn } from "@/lib/utils";

// Adapted from Vercel AI Elements' audio-player.tsx (MIT).

export type AudioPlayerProps = Omit<
  ComponentProps<typeof MediaController>,
  "audio"
>;

export function AudioPlayer({
  children,
  style,
  className,
  ...props
}: AudioPlayerProps & { className?: string }) {
  return (
    <MediaController
      audio
      data-slot="audio-player"
      // MediaController defaults to inline-flex; force block so it fills.
      className={cn("block w-full", className)}
      style={
        {
          "--media-background-color": "transparent",
          "--media-button-icon-height": "1rem",
          "--media-button-icon-width": "1rem",
          "--media-control-background": "transparent",
          "--media-control-hover-background": "var(--color-accent)",
          "--media-control-padding": "0.375rem",
          "--media-font": "var(--font-sans)",
          "--media-font-size": "12px",
          "--media-icon-color": "currentColor",
          "--media-primary-color": "var(--color-primary)",
          "--media-range-bar-color": "var(--color-primary)",
          "--media-range-track-background": "var(--color-secondary)",
          "--media-secondary-color": "var(--color-secondary)",
          "--media-text-color": "var(--color-foreground)",
          ...style,
        } as CSSProperties
      }
      {...props}
    >
      {children}
    </MediaController>
  );
}

export type AudioPlayerControlBarProps = ComponentProps<typeof MediaControlBar>;

export function AudioPlayerControlBar({
  className,
  ...props
}: AudioPlayerControlBarProps) {
  // No flex/gap overrides — <media-control-bar> natively stretches a child
  // <media-time-range>; custom flex rules break that.
  return (
    <MediaControlBar
      data-slot="audio-player-control-bar"
      className={cn("w-full", className)}
      {...props}
    />
  );
}

export type AudioPlayerPlayButtonProps = ComponentProps<typeof MediaPlayButton>;

export function AudioPlayerPlayButton({
  className,
  ...props
}: AudioPlayerPlayButtonProps) {
  return (
    <MediaPlayButton
      data-slot="audio-player-play-button"
      className={cn(
        "rounded-md text-muted-foreground hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export type AudioPlayerTimeRangeProps = ComponentProps<typeof MediaTimeRange>;

export function AudioPlayerTimeRange({
  className,
  ...props
}: AudioPlayerTimeRangeProps) {
  return (
    <MediaTimeRange
      data-slot="audio-player-time-range"
      className={cn("h-6", className)}
      {...props}
    />
  );
}

export type AudioPlayerTimeDisplayProps = ComponentProps<typeof MediaTimeDisplay>;

export function AudioPlayerTimeDisplay({
  className,
  ...props
}: AudioPlayerTimeDisplayProps) {
  return (
    <MediaTimeDisplay
      data-slot="audio-player-time-display"
      className={cn("tabular-nums text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export type AudioPlayerDurationDisplayProps = ComponentProps<
  typeof MediaDurationDisplay
>;

export function AudioPlayerDurationDisplay({
  className,
  ...props
}: AudioPlayerDurationDisplayProps) {
  return (
    <MediaDurationDisplay
      data-slot="audio-player-duration-display"
      className={cn("tabular-nums text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}
