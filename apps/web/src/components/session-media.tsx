"use client";
import { useEffect, useRef, useState } from "react";
import { MicOff, VideoOff, Volume2 } from "lucide-react";
import type { VideoParticipant } from "@/lib/video-connection";

/** Vezuje aktivne trake za video; tuđe trake ne zaustavlja jer njima upravlja SDK. */
export function SessionMedia({
  participant,
  label,
  screen = false,
}: {
  participant: VideoParticipant;
  label: string;
  screen?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const videoTrack = screen ? participant.screenVideo : participant.video;
  const audioTrack = screen ? participant.screenAudio : participant.audio;
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.srcObject = videoTrack ? new MediaStream([videoTrack]) : null;
    if (videoTrack) void element.play().catch(() => undefined);
    return () => {
      element.srcObject = null;
    };
  }, [videoTrack]);
  useEffect(() => {
    const element = audio.current;
    if (!element || participant.local || !audioTrack) return;
    element.srcObject = new MediaStream([audioTrack]);
    let active = true;
    setAudioBlocked(false);
    void element.play().catch(() => {
      if (active) setAudioBlocked(true);
    });
    return () => {
      active = false;
      element.srcObject = null;
    };
  }, [audioTrack, participant.local]);
  /** Browser ponekad traži dodatni klik da dozvoli automatsku reprodukciju tuđeg zvuka. */
  async function handleEnableAudio() {
    try {
      await audio.current?.play();
      setAudioBlocked(false);
    } catch {
      setAudioBlocked(true);
    }
  }
  return (
    <div
      className={`session-video-tile${participant.local && !screen ? " session-self" : ""}${screen ? " session-screen" : ""}`}
    >
      <video
        ref={video}
        autoPlay
        playsInline
        muted
        aria-label={label}
        hidden={!videoTrack}
      />
      {!videoTrack && (
        <div className="session-camera-placeholder">
          <VideoOff size={30} />
          <span>{label}</span>
        </div>
      )}
      <audio ref={audio} autoPlay />
      <span className="session-video-label">
        {!participant.microphoneOn && <MicOff size={14} />}
        {label}
      </span>
      {audioBlocked && (
        <button
          type="button"
          className="session-enable-audio"
          onClick={handleEnableAudio}
        >
          <Volume2 size={16} /> Uključi zvuk
        </button>
      )}
    </div>
  );
}
