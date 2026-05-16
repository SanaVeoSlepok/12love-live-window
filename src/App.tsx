import { PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import frontCornice from "./assets/front-cornice.png";

type BackgroundId = "midnight" | "dawn" | "garden" | "aurora";
type DragLayer = "curtain" | "tulle";
type DragIntent = "x" | "y" | null;
type TiltPermission = "idle" | "granted" | "denied" | "unsupported";
type DeviceOrientationEventWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<PermissionState>;
};
type MicStatus = "idle" | "requesting" | "listening" | "stopped" | "error";
type SpeechEngineName = "SpeechRecognition" | "webkitSpeechRecognition" | "none";

type TelegramWebApp = {
  initData?: string;
  platform?: string;
  version?: string;
  colorScheme?: "light" | "dark";
  isActive?: boolean;
  ready?: () => void;
  expand?: () => void;
  requestFullscreen?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  HapticFeedback?: {
    impactOccurred?: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
    notificationOccurred?: (type: "error" | "success" | "warning") => void;
  };
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  abort: () => void;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechRecognitionErrorLike = {
  error: string;
  message?: string;
};

type SpeechRecognitionResultEventLike = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: {
        transcript: string;
      };
    };
  };
};

type MicDiagnostics = {
  audioTracks: number;
  error: string;
  finalTranscript: string;
  isSecure: boolean;
  isTelegram: boolean;
  lastTranscript: string;
  mediaDevices: boolean;
  platform: string;
  speechEngine: SpeechEngineName;
  telegramVersion: string;
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

type DragState = {
  pointerId: number;
  layer: DragLayer;
  startX: number;
  startY: number;
  startReveal: number;
  intent: DragIntent;
};

type WordToken = {
  text: string;
  wordIndex: number | null;
};

const backgrounds: { id: BackgroundId; aria: string }[] = [
  { id: "midnight", aria: "Ночной фон" },
  { id: "dawn", aria: "Рассветный фон" },
  { id: "garden", aria: "Садовый фон" },
  { id: "aurora", aria: "Северный фон" },
];

const firstText = `ты входишь тихо
и весь город за стеклом
становится мягче`;

const secondText = `там, где свет касается слов,
появляется маленькое золото
и остается дышать`;

const thirdText = `штора помнит движение руки,
тюль пропускает только сияние,
а окно держит нашу ночь`;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const normalizeWord = (value: string) =>
  value
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/[^a-zа-я0-9]+/giu, "");

const extractSpeechWords = (value: string) =>
  value
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/[^a-zа-я0-9]+/giu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const getSpeechEngine = (): {
  Constructor: SpeechRecognitionConstructor | null;
  name: SpeechEngineName;
} => {
  if (window.SpeechRecognition) {
    return { Constructor: window.SpeechRecognition, name: "SpeechRecognition" };
  }

  if (window.webkitSpeechRecognition) {
    return { Constructor: window.webkitSpeechRecognition, name: "webkitSpeechRecognition" };
  }

  return { Constructor: null, name: "none" };
};

const alignTranscriptToText = (
  expectedWords: string[],
  transcript: string,
  fallbackIndex: number,
) => {
  const heardWords = extractSpeechWords(transcript);

  if (heardWords.length === 0 || expectedWords.length === 0) {
    return fallbackIndex;
  }

  let cursor = 0;
  let lastMatch = fallbackIndex;

  heardWords.forEach((heardWord) => {
    const searchLimit = Math.min(expectedWords.length, cursor + 10);

    for (let index = cursor; index < searchLimit; index += 1) {
      if (expectedWords[index] === heardWord) {
        cursor = index + 1;
        lastMatch = index;
        return;
      }
    }
  });

  return lastMatch;
};

function App() {
  const [background, setBackground] = useState<BackgroundId>("midnight");
  const [blocks, setBlocks] = useState([firstText, secondText, thirdText]);
  const [fontSize, setFontSize] = useState(30);
  const [studioOpen, setStudioOpen] = useState(false);
  const [activeWord, setActiveWord] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [curtainReveal, setCurtainReveal] = useState(() =>
    Math.min(14, window.innerWidth * 0.08),
  );
  const [tulleReveal, setTulleReveal] = useState(() =>
    Math.min(18, window.innerWidth * 0.1),
  );
  const [parallax, setParallax] = useState(0);
  const [tiltPermission, setTiltPermission] = useState<TiltPermission>(() =>
    "DeviceOrientationEvent" in window ? "idle" : "unsupported",
  );
  const [telegramApp, setTelegramApp] = useState<TelegramWebApp | null>(null);
  const [micStatus, setMicStatus] = useState<MicStatus>("idle");
  const [micDiagnostics, setMicDiagnostics] = useState<MicDiagnostics>(() => {
    const speechEngine = getSpeechEngine().name;

    return {
      audioTracks: 0,
      error: "",
      finalTranscript: "",
      isSecure: window.isSecureContext,
      isTelegram: Boolean(window.Telegram?.WebApp?.initData),
      lastTranscript: "",
      mediaDevices: Boolean(navigator.mediaDevices?.getUserMedia),
      platform: window.Telegram?.WebApp?.platform ?? "web",
      speechEngine,
      telegramVersion: window.Telegram?.WebApp?.version ?? "",
    };
  });
  const dragRef = useRef<DragState | null>(null);
  const parallaxFrame = useRef<number | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechActiveRef = useRef(false);
  const finalTranscriptRef = useRef("");

  const text = blocks.join("\n\n");

  const tokens = useMemo<WordToken[]>(() => {
    let wordIndex = 0;

    return text.split(/(\s+)/).map((part) => {
      if (!part.trim()) {
        return { text: part, wordIndex: null };
      }

      const token = { text: part, wordIndex };
      wordIndex += 1;
      return token;
    });
  }, [text]);

  const wordCount = useMemo(
    () => tokens.filter((token) => token.wordIndex !== null).length,
    [tokens],
  );
  const expectedWords = useMemo(
    () =>
      tokens
        .filter((token) => token.wordIndex !== null)
        .map((token) => normalizeWord(token.text))
        .filter(Boolean),
    [tokens],
  );

  const curtainMax = Math.min(viewportWidth * 0.78, 348);
  const tulleMax = Math.min(viewportWidth * 0.9, 420);

  useEffect(() => {
    const webApp = window.Telegram?.WebApp ?? null;

    if (!webApp) {
      return;
    }

    setTelegramApp(webApp);
    setMicDiagnostics((current) => ({
      ...current,
      isTelegram: Boolean(webApp.initData),
      platform: webApp.platform ?? "telegram",
      telegramVersion: webApp.version ?? "",
    }));

    webApp.ready?.();
    webApp.expand?.();
    webApp.setHeaderColor?.("#101016");
    webApp.setBackgroundColor?.("#101016");
  }, []);

  useEffect(() => {
    const handleResize = () => {
      const nextWidth = window.innerWidth;
      setViewportWidth(nextWidth);
      setCurtainReveal((value) => clamp(value, 6, Math.min(nextWidth * 0.78, 348)));
      setTulleReveal((value) => clamp(value, 8, Math.min(nextWidth * 0.9, 420)));
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (wordCount === 0) {
      setActiveWord(0);
      return;
    }

    if (micStatus === "listening" || micStatus === "requesting") {
      return;
    }

    const timer = window.setInterval(() => {
      setActiveWord((index) => (index + 1) % wordCount);
    }, 920);

    return () => window.clearInterval(timer);
  }, [micStatus, wordCount]);

  useEffect(() => {
    if (tiltPermission !== "granted") {
      return;
    }

    const handleOrientation = (event: DeviceOrientationEvent) => {
      if (typeof event.gamma !== "number") {
        return;
      }

      setParallax(clamp(event.gamma / 14, -1, 1));
    };

    window.addEventListener("deviceorientation", handleOrientation);
    return () => window.removeEventListener("deviceorientation", handleOrientation);
  }, [tiltPermission]);

  const requestTiltPermission = async () => {
    if (!("DeviceOrientationEvent" in window)) {
      setTiltPermission("unsupported");
      return;
    }

    const orientationEvent =
      window.DeviceOrientationEvent as DeviceOrientationEventWithPermission;

    try {
      if (typeof orientationEvent.requestPermission === "function") {
        const permission = await orientationEvent.requestPermission();
        setTiltPermission(permission === "granted" ? "granted" : "denied");
        return;
      }

      setTiltPermission("granted");
    } catch {
      setTiltPermission("denied");
    }
  };

  useEffect(
    () => () => {
      speechActiveRef.current = false;
      recognitionRef.current?.abort();
      micStreamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const updateMicDiagnostics = (patch: Partial<MicDiagnostics>) => {
    setMicDiagnostics((current) => ({ ...current, ...patch }));
  };

  const stopMicSession = () => {
    speechActiveRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    setMicStatus("stopped");
    updateMicDiagnostics({ audioTracks: 0 });
  };

  const startMicSession = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicStatus("error");
      updateMicDiagnostics({
        error: "microphone api unavailable",
        isSecure: window.isSecureContext,
        mediaDevices: false,
      });
      return;
    }

    setMicStatus("requesting");
    setActiveWord(0);
    finalTranscriptRef.current = "";
    updateMicDiagnostics({
      audioTracks: 0,
      error: "",
      finalTranscript: "",
      isSecure: window.isSecureContext,
      lastTranscript: "",
      mediaDevices: true,
      speechEngine: getSpeechEngine().name,
    });
    telegramApp?.HapticFeedback?.impactOccurred?.("light");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      const tracks = stream.getAudioTracks();
      micStreamRef.current = stream;
      speechActiveRef.current = true;
      setMicStatus("listening");
      updateMicDiagnostics({ audioTracks: tracks.length });

      const { Constructor, name } = getSpeechEngine();
      updateMicDiagnostics({ speechEngine: name });

      if (!Constructor) {
        updateMicDiagnostics({
          error: "speech recognition unavailable",
        });
        return;
      }

      const recognition = new Constructor();
      recognition.lang = "ru-RU";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognitionRef.current = recognition;

      recognition.onresult = (event) => {
        let finalChunk = "";
        let interimChunk = "";

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = result[0]?.transcript ?? "";

          if (result.isFinal) {
            finalChunk += `${transcript} `;
          } else {
            interimChunk += transcript;
          }
        }

        if (finalChunk) {
          finalTranscriptRef.current = `${finalTranscriptRef.current} ${finalChunk}`.trim();
        }

        const liveTranscript = `${finalTranscriptRef.current} ${interimChunk}`.trim();
        const nextActiveWord = alignTranscriptToText(
          expectedWords,
          liveTranscript,
          activeWord,
        );

        setActiveWord(clamp(nextActiveWord, 0, Math.max(wordCount - 1, 0)));
        updateMicDiagnostics({
          error: "",
          finalTranscript: finalTranscriptRef.current,
          lastTranscript: liveTranscript,
        });
      };

      recognition.onerror = (event) => {
        const isSoftError = event.error === "no-speech" || event.error === "aborted";
        updateMicDiagnostics({
          error: isSoftError ? "" : `${event.error}${event.message ? `: ${event.message}` : ""}`,
        });

        if (!isSoftError) {
          telegramApp?.HapticFeedback?.notificationOccurred?.("warning");
        }
      };

      recognition.onend = () => {
        if (!speechActiveRef.current) {
          return;
        }

        window.setTimeout(() => {
          try {
            recognition.start();
          } catch {
            updateMicDiagnostics({ error: "speech restart failed" });
          }
        }, 240);
      };

      recognition.start();
    } catch (error) {
      const message = error instanceof Error ? error.message : "microphone request failed";
      setMicStatus("error");
      speechActiveRef.current = false;
      micStreamRef.current?.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
      updateMicDiagnostics({ audioTracks: 0, error: message });
      telegramApp?.HapticFeedback?.notificationOccurred?.("error");
    }
  };

  const updateBlock = (index: number, value: string) => {
    setBlocks((current) =>
      current.map((block, blockIndex) => (blockIndex === index ? value : block)),
    );
  };

  const startDrag =
    (layer: DragLayer) => (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }

      dragRef.current = {
        pointerId: event.pointerId,
        layer,
        startX: event.clientX,
        startY: event.clientY,
        startReveal: layer === "curtain" ? curtainReveal : tulleReveal,
        intent: null,
      };

      event.currentTarget.setPointerCapture(event.pointerId);
    };

  const moveDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (!drag.intent) {
      if (Math.max(absX, absY) < 8) {
        return;
      }

      drag.intent = absX > absY ? "x" : "y";
    }

    if (drag.intent === "y") {
      return;
    }

    event.preventDefault();

    if (drag.layer === "curtain") {
      setCurtainReveal(clamp(drag.startReveal - dx, 6, curtainMax));
      return;
    }

    setTulleReveal(clamp(drag.startReveal - dx, 8, tulleMax));
  };

  const stopDrag = (event: PointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  };

  const handleScenePointerMove = (event: PointerEvent<HTMLElement>) => {
    if (dragRef.current) {
      return;
    }

    if (parallaxFrame.current !== null) {
      window.cancelAnimationFrame(parallaxFrame.current);
    }

    const next = clamp((event.clientX / window.innerWidth - 0.5) * 2, -1, 1);
    parallaxFrame.current = window.requestAnimationFrame(() => {
      setParallax(next);
      parallaxFrame.current = null;
    });
  };

  const rootStyle = {
    "--curtain-reveal": `${curtainReveal}px`,
    "--tulle-reveal": `${tulleReveal}px`,
    "--story-size": `${fontSize}px`,
    "--peek": `${parallax * 22}px`,
    "--bg-shift": `${parallax * -24}px`,
  } as React.CSSProperties;

  return (
    <main
      className={`liveWindow studio-${studioOpen ? "open" : "closed"}`}
      style={rootStyle}
      onPointerMove={handleScenePointerMove}
    >
      <BackgroundLayer background={background} />
      <TextLayer activeWord={activeWord} tokens={tokens} />

      <TulleLayer
        onPointerDown={startDrag("tulle")}
        onPointerMove={moveDrag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      />

      <CurtainLayer
        onPointerDown={startDrag("curtain")}
        onPointerMove={moveDrag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      />

      <HardwareLayer />

      {studioOpen && (
        <CreativeStudio
          background={background}
          blocks={blocks}
          fontSize={fontSize}
          onBackgroundChange={setBackground}
          onBlockChange={updateBlock}
          onClose={() => setStudioOpen(false)}
          onFontSizeChange={setFontSize}
        />
      )}

      {tiltPermission !== "granted" && tiltPermission !== "unsupported" && (
        <button
          className={`tiltAction ${tiltPermission === "denied" ? "denied" : ""}`}
          type="button"
          aria-label="Разрешить наклон"
          onClick={requestTiltPermission}
        >
          <TiltIcon denied={tiltPermission === "denied"} />
        </button>
      )}

      {micStatus !== "idle" && (
        <MicDiagnosticsPanel diagnostics={micDiagnostics} status={micStatus} />
      )}

      <button
        className={`micAction ${micStatus}`}
        type="button"
        aria-label={micStatus === "listening" ? "Остановить микрофон" : "Проверить микрофон"}
        onClick={
          micStatus === "listening" || micStatus === "requesting"
            ? stopMicSession
            : startMicSession
        }
      >
        <MicIcon active={micStatus === "listening"} />
      </button>

      <button
        className="studioAction"
        type="button"
        aria-label={studioOpen ? "Закрыть студию" : "Открыть студию"}
        onClick={() => setStudioOpen((open) => !open)}
      >
        <ActionIcon open={studioOpen} />
      </button>
    </main>
  );
}

function BackgroundLayer({ background }: { background: BackgroundId }) {
  return <div className={`backgroundLayer bg-${background}`} aria-hidden="true" />;
}

function TextLayer({
  activeWord,
  tokens,
}: {
  activeWord: number;
  tokens: WordToken[];
}) {
  return (
    <section className="textLayer" aria-label="Текст">
      <div className="storyText">
        {tokens.map((token, index) => {
          if (token.wordIndex === null) {
            return <span key={`${index}-space`}>{token.text}</span>;
          }

          const status =
            token.wordIndex === activeWord
              ? "active"
              : token.wordIndex < activeWord
                ? "spoken"
                : "normal";

          return (
            <span className={`wordToken ${status}`} key={`${token.text}-${index}`}>
              {token.text}
            </span>
          );
        })}
      </div>
    </section>
  );
}

function TulleLayer({
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
}) {
  return (
    <section className="tulleLayer" aria-hidden="true">
      <div className="tulleVeil" />
      <button
        className="tulleEdge"
        type="button"
        tabIndex={-1}
        onPointerCancel={onPointerCancel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <button
        className="tulleScallop"
        type="button"
        tabIndex={-1}
        onPointerCancel={onPointerCancel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <svg viewBox="0 0 360 40" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 0H360V21C344 36 328 36 312 21C296 6 280 6 264 21C248 36 232 36 216 21C200 6 184 6 168 21C152 36 136 36 120 21C104 6 88 6 72 21C56 36 40 36 24 21C14 12 7 9 0 10Z" />
        </svg>
      </button>
    </section>
  );
}

function CurtainLayer({
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
}) {
  return (
    <section className="curtainLayer" aria-hidden="true">
      <button
        className="curtainPanel"
        type="button"
        tabIndex={-1}
        onPointerCancel={onPointerCancel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className="curtainHem" />
      </button>
    </section>
  );
}

function HardwareLayer() {
  return (
    <section className="hardwareLayer" aria-hidden="true">
      <FrontCornice />
      <div className="tulleRings">
        {Array.from({ length: 8 }).map((_, index) => (
          <span className="ring tulleRing" key={`tulle-${index}`} />
        ))}
      </div>
      <div className="curtainRings">
        {Array.from({ length: 7 }).map((_, index) => (
          <span className="ring curtainRing" key={`curtain-${index}`} />
        ))}
      </div>
    </section>
  );
}

function FrontCornice() {
  return (
    <img className="frontCornice" src={frontCornice} alt="" draggable="false" />
  );
}

function CreativeStudio({
  background,
  blocks,
  fontSize,
  onBackgroundChange,
  onBlockChange,
  onClose,
  onFontSizeChange,
}: {
  background: BackgroundId;
  blocks: string[];
  fontSize: number;
  onBackgroundChange: (background: BackgroundId) => void;
  onBlockChange: (index: number, value: string) => void;
  onClose: () => void;
  onFontSizeChange: (fontSize: number) => void;
}) {
  return (
    <section className="creativeStudio" aria-label="Студия">
      <div className="studioTop">
        <button className="studioClose" type="button" aria-label="Закрыть" onClick={onClose}>
          <ActionIcon open />
        </button>
        <div className="sizeControl">
          <TextSizeIcon />
          <input
            aria-label="Размер текста"
            max="46"
            min="22"
            onChange={(event) => onFontSizeChange(Number(event.currentTarget.value))}
            type="range"
            value={fontSize}
          />
        </div>
      </div>

      <div className="studioBlocks">
        {blocks.map((block, index) => (
          <textarea
            aria-label={`Текст ${index + 1}`}
            key={`block-${index}`}
            onChange={(event) => onBlockChange(index, event.currentTarget.value)}
            spellCheck="false"
            value={block}
          />
        ))}
      </div>

      <div className="backgroundPicker" aria-label="Фоны">
        {backgrounds.map((item) => (
          <button
            aria-label={item.aria}
            aria-pressed={background === item.id}
            className={`backgroundThumb bg-${item.id}`}
            key={item.id}
            onClick={() => onBackgroundChange(item.id)}
            type="button"
          />
        ))}
      </div>
    </section>
  );
}

function MicDiagnosticsPanel({
  diagnostics,
  status,
}: {
  diagnostics: MicDiagnostics;
  status: MicStatus;
}) {
  const statusLabel: Record<MicStatus, string> = {
    error: "ошибка",
    idle: "ожидание",
    listening: "слушает",
    requesting: "запрос",
    stopped: "стоп",
  };
  const engineLabel =
    diagnostics.speechEngine === "none" ? "нет" : diagnostics.speechEngine;
  const shortTranscript = diagnostics.lastTranscript || diagnostics.finalTranscript || "тишина";

  return (
    <section className="micDiagnostics" aria-label="Диагностика микрофона">
      <div className="micStatusLine">
        <span className={`micDot ${status}`} />
        <span>{statusLabel[status]}</span>
      </div>
      <div className="micGrid">
        <span>TG</span>
        <strong>{diagnostics.isTelegram ? diagnostics.platform : "web"}</strong>
        <span>HTTPS</span>
        <strong>{diagnostics.isSecure ? "да" : "нет"}</strong>
        <span>mic</span>
        <strong>{diagnostics.audioTracks || (diagnostics.mediaDevices ? "есть" : "нет")}</strong>
        <span>speech</span>
        <strong>{engineLabel}</strong>
      </div>
      <p className="micTranscript">{shortTranscript}</p>
      {diagnostics.error && <p className="micError">{diagnostics.error}</p>}
      {diagnostics.telegramVersion && (
        <p className="micVersion">Telegram {diagnostics.telegramVersion}</p>
      )}
    </section>
  );
}

function ActionIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {open ? (
        <path d="M6 6L18 18M18 6L6 18" />
      ) : (
        <path d="M12 5V19M5 12H19" />
      )}
    </svg>
  );
}

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4C10.35 4 9 5.35 9 7V12C9 13.65 10.35 15 12 15C13.65 15 15 13.65 15 12V7C15 5.35 13.65 4 12 4Z" />
      <path d="M6.5 11.5C6.5 14.55 8.95 17 12 17C15.05 17 17.5 14.55 17.5 11.5" />
      <path d="M12 17V20" />
      <path d="M9 20H15" />
      {active && <path d="M18.5 6.5C20 8.4 20 12.3 18.5 14.2" />}
      {active && <path d="M5.5 6.5C4 8.4 4 12.3 5.5 14.2" />}
    </svg>
  );
}

function TiltIcon({ denied }: { denied: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4H16L18.5 20H5.5L8 4Z" />
      <path d="M9.5 8H14.5" />
      <path d="M8 16C10.4 14.7 13.6 14.7 16 16" />
      {denied && <path d="M5 5L19 19" />}
    </svg>
  );
}

function TextSizeIcon() {
  return (
    <svg viewBox="0 0 28 28" aria-hidden="true">
      <path d="M5 22L12.5 5H15.5L23 22" />
      <path d="M8.4 15.6H19.6" />
      <path d="M3.5 22H9.5M18.5 22H24.5" />
    </svg>
  );
}

export default App;
