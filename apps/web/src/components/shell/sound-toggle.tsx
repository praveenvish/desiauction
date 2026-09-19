"use client";

import { IconVolume, IconVolumeOff, useSoundPreference } from "@desiauction/ui";

/**
 * The sound switch. Sound is a device-local choice, so this sits beside the
 * theme toggle rather than on the account page. Turning it on is the gesture
 * that unlocks the browser's audio, so the unlock happens inside this click
 * and nowhere else; a surface that only ever plays cues never needs one.
 */
export function SoundToggle({ className = "shell-icon-button" }: { className?: string }) {
  const sound = useSoundPreference();
  const label = sound.enabled ? "Turn sound off" : "Turn sound on";
  return (
    <button
      type="button"
      className={className}
      data-testid="sound-toggle"
      aria-pressed={sound.enabled}
      aria-label={label}
      title={sound.enabled ? "Sound on" : "Sound off"}
      onClick={() => {
        void sound.setEnabled(!sound.enabled);
      }}
    >
      {sound.ready && sound.enabled ? <IconVolume size={18} /> : <IconVolumeOff size={18} />}
    </button>
  );
}
