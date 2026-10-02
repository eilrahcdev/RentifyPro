export const ICON_SIZE = Object.freeze({
  compact: 16,
  control: 18,
  navigation: 20,
  card: 24,
  feature: 32,
  display: 40,
});

export default function AppIcon({
  icon: Icon,
  size = ICON_SIZE.navigation,
  strokeWidth = 2,
  className = "",
  decorative = true,
  ...props
}) {
  return (
    <Icon
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden={decorative || undefined}
      {...props}
    />
  );
}
