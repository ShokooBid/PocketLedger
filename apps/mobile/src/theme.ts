// Hand-written design tokens. Final branding and dark mode are later work.
export const theme = {
  color: {
    background: "#F4F7FA",
    surface: "#FFFFFF",
    text: "#152536",
    muted: "#45566A",
    primary: "#175A72",
    onPrimary: "#FFFFFF",
    border: "#788899",
    error: "#A12622"
  },
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: 12,
  font: { body: 16, heading: 28 },
  touchTarget: 48
} as const;
