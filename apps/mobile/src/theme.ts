// Hand-written tokens based on the supplied purple/pink reference. Decorative
// gradient colors stay separate from the darker, accessible control/text colors.
export const theme = {
  color: {
    background: "#FFFFFF",
    surface: "#FFFFFF",
    text: "#30213F",
    muted: "#6D5A7C",
    primary: "#7043D9",
    onPrimary: "#FFFFFF",
    border: "#9785A8",
    softBorder: "#E8DFF2",
    primarySoft: "#F6F1FF",
    accent: "#EE3998",
    gradientStart: "#F63898",
    gradientEnd: "#9B80FF",
    decorationDot: "#C65CC1",
    error: "#A32255"
  },
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: 22,
  pillRadius: 999,
  font: { body: 16, heading: 28 },
  touchTarget: 48
} as const;
