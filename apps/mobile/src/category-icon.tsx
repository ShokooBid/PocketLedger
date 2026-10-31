import { useId, useMemo } from "react";
import Svg, { Circle, Path, SvgXml } from "react-native-svg";
import { categoryIconXml } from "./category-icon-data";
import { theme } from "./theme";

// Decorative: adjacent category text/button labels provide the accessible name.
export function CategoryIcon({
  iconKey,
  size = 36
}: {
  iconKey?: string | undefined;
  size?: number;
}) {
  const id = useId();
  const xml = useMemo(() => categoryIconXml(iconKey, id), [iconKey, id]);
  const accessibility = {
    accessible: false,
    accessibilityElementsHidden: true,
    importantForAccessibility: "no-hide-descendants" as const
  };
  if (xml)
    return <SvgXml xml={xml} width={size} height={size} {...accessibility} />;
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" {...accessibility}>
      <Circle cx={32} cy={32} r={30} fill={theme.color.primarySoft} />
      <Path
        d="M18 23h11l4 5h13v17H18Z"
        fill="none"
        stroke={theme.color.muted}
        strokeWidth={3}
        strokeLinejoin="round"
      />
    </Svg>
  );
}
