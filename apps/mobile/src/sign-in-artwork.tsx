import { useId } from "react";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Rect,
  Stop
} from "react-native-svg";

const decorative = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: "no-hide-descendants" as const
};

export function SignInBanner() {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <Svg
      width="100%"
      height="100%"
      viewBox="0 0 400 140"
      preserveAspectRatio="none"
      {...decorative}
    >
      <Defs>
        <LinearGradient id={id} x1="0%" y1="0%" x2="100%" y2="80%">
          <Stop offset="0%" stopColor="#F63898" />
          <Stop offset="55%" stopColor="#B346DE" />
          <Stop offset="100%" stopColor="#7654FF" />
        </LinearGradient>
      </Defs>
      <Path
        d="M0 0H400V128C354 91 300 117 230 126C146 137 94 77 0 126Z"
        fill={`url(#${id})`}
      />
      <Path
        d="M225 0H400V29C337 49 278 43 225 0Z"
        fill="#F63898"
        opacity={0.35}
      />
    </Svg>
  );
}

export function WalletMark() {
  return (
    <Svg width={30} height={32} viewBox="0 0 32 34" {...decorative}>
      <Path
        d="M5 10V8c0-2 1-3 3-4l12-3c2 0 3 1 3 3v5M25 13V9H7c-3 0-5 2-5 5v13c0 3 2 5 5 5h18c3 0 5-2 5-5v-5M29 14h-7c-2 0-3 2-3 4s1 4 3 4h7V14Z"
        fill="none"
        stroke="#FFF"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function WalletIllustration({ size }: { size: number }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <Svg width={size} height={size} viewBox="0 0 150 150" {...decorative}>
      <Defs>
        <LinearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor="#B143DA" />
          <Stop offset="100%" stopColor="#7939CC" />
        </LinearGradient>
      </Defs>
      <Circle cx={80} cy={72} r={65} fill="#F0E3FA" />
      <Circle cx={14} cy={96} r={12} fill="#F0E3FA" />
      <Path
        d="M43 60V51c0-5 3-9 8-11l43-17c5-2 9 0 11 5l7 22"
        fill="#FFF8DE"
        stroke="#9143CD"
        strokeWidth={5}
        strokeLinejoin="round"
      />
      <Path
        d="m45 52 65-8c4 0 7 3 7 7v10H45Z"
        fill="#FFF"
        stroke="#9143CD"
        strokeWidth={5}
        strokeLinejoin="round"
      />
      <Rect x={39} y={53} width={89} height={69} rx={12} fill={`url(#${id})`} />
      <Rect x={64} y={98} width={7} height={13} rx={2} fill="#FFF" />
      <Rect x={77} y={91} width={7} height={20} rx={2} fill="#FFF" />
      <Rect x={90} y={83} width={7} height={28} rx={2} fill="#FFF" />
      <Circle cx={115} cy={86} r={6} fill="#FFF" />
    </Svg>
  );
}

export function SignInIcon({
  kind
}: {
  kind: "email" | "lock" | "eye" | "eye-off";
}) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" {...decorative}>
      <Path
        d={
          kind === "email"
            ? "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm0 1 8 6 8-6"
            : kind === "lock"
              ? "M7 10V7a5 5 0 0 1 10 0v3M6 10h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z"
              : "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0"
        }
        fill="none"
        stroke="#756184"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {kind === "eye-off" && (
        <Path
          d="m3 3 18 18"
          stroke="#756184"
          strokeWidth={1.7}
          strokeLinecap="round"
        />
      )}
    </Svg>
  );
}

export function GoogleMark() {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" {...decorative}>
      <Path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"
      />
      <Path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.97-3.38.97-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z"
      />
      <Path
        fill="#FBBC05"
        d="M6.41 13.93a6 6 0 0 1 0-3.86V7.48H3.07a10 10 0 0 0 0 9.04l3.34-2.59Z"
      />
      <Path
        fill="#EA4335"
        d="M12 5.95c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.48l3.34 2.59A5.99 5.99 0 0 1 12 5.95Z"
      />
    </Svg>
  );
}
