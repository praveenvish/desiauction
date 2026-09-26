// FLOODLIGHT design system. M-IP1-1 tokens + M-IP1-2 primitives (IP-1_DESIGN §9).
export { tokens, semanticTokenNames } from "./generated/tokens";
export type { SemanticToken } from "./generated/tokens";

export { Button, ButtonLink, buttonClassName } from "./primitives/button";
export type { ButtonProps, ButtonLinkProps, ButtonVariant, ButtonSize } from "./primitives/button";
export { LinkComponentProvider, isRouterHref, useLinkComponent } from "./primitives/link-context";
export { Badge } from "./primitives/badge";
export { StarGlyphs } from "./primitives/star-glyphs";
export type { BadgeProps, BadgeTone } from "./primitives/badge";
export { Card, cardClassName } from "./primitives/card";
export type { CardProps, CardElevation } from "./primitives/card";
export { Money } from "./primitives/money";
export type { MoneyProps, MoneyTone } from "./primitives/money";
export { Skeleton } from "./primitives/skeleton";
export type { SkeletonProps } from "./primitives/skeleton";
export { EmptyState } from "./primitives/empty-state";
export type { EmptyStateProps } from "./primitives/empty-state";
// The round-3B system: one pager, one list row, one eyebrow, one scroll strip.
export { Pager, pageWindow } from "./primitives/pager";
export type { PagerProps } from "./primitives/pager";
export { ListRow, StateDot } from "./primitives/list-row";
export type { ListRowProps } from "./primitives/list-row";
export { Eyebrow } from "./primitives/eyebrow";
export { ScrollStrip } from "./primitives/scroll-strip";
export type { ScrollStripProps } from "./primitives/scroll-strip";
export { useScrollStrip } from "./primitives/use-scroll-strip";
export { Stat, StatRow } from "./primitives/stat";
export type { StatProps, StatRowProps } from "./primitives/stat";
export { Field, Select } from "./primitives/field";
export type { FieldProps, SelectProps } from "./primitives/field";
export {
  CardGrid,
  CONCEPT_TONE,
  HeroBanner,
  IconTile,
  JourneyStepper,
  Notice,
  Pill,
  SectionCard,
  StatCard,
  StatGrid,
  TeamChip,
  kitTone,
  statusState,
} from "./primitives/console-kit";
export { KitFigure } from "./primitives/console-kit-figure";
export type {
  HeroBannerProps,
  IconTileProps,
  JourneyStep,
  KitConcept,
  KitTone,
  NoticeProps,
  PillProps,
  SectionCardProps,
  StatCardProps,
  StateKey,
} from "./primitives/console-kit";
export { Tabs } from "./primitives/tabs";
export {
  Toolbar,
  ToolbarSpacer,
  ToolbarCount,
  ToolbarSearch,
  ToolbarChip,
  FilterMenu,
  SegmentedTabs,
  ToolbarSelect,
  ToolbarToggle,
} from "./primitives/toolbar";
export type {
  ToolbarSearchProps,
  SegmentedItem,
  ToolbarSelectProps,
  ToolbarToggleItem,
} from "./primitives/toolbar";
export type { TabsProps, TabItem } from "./primitives/tabs";
export { Dialog } from "./primitives/dialog";
export type { DialogProps } from "./primitives/dialog";
export { ToastProvider, useToast } from "./primitives/toast";
export type { ToastOptions, ToastTone } from "./primitives/toast";

export { useHoldGate } from "./motion/use-hold-gate";
export { Tilt } from "./motion/tilt";
export type { TiltProps } from "./motion/tilt";
export { Reveal } from "./motion/reveal";
export type { RevealProps } from "./motion/reveal";
export { createSoundEngine } from "./sound/engine";
export type { SoundEngine } from "./sound/engine";
export { SOUND_CUES, scheduleCue } from "./sound/cues";
export type { SoundCue } from "./sound/cues";
export {
  soundEngine,
  useSoundPreference,
  useSoundCue,
  readSoundPreference,
  resetSoundPreferenceForTests,
  SOUND_STORAGE_KEY,
} from "./sound/use-sound";
export type { SoundPreference } from "./sound/use-sound";
export type { HoldGate, HoldGateBind, HoldGateOptions } from "./motion/use-hold-gate";
export { AnnouncerProvider, useAnnouncer } from "./live/announcer";
export type { Announce, AnnounceChannel } from "./live/announcer";
export { VisuallyHidden } from "./live/visually-hidden";

// The auction theatre (PREMIUM-1): the primitives every SOLD shares.
export { RollingNumber } from "./theatre/rolling-number";
export type { RollingNumberProps } from "./theatre/rolling-number";
export { SoldStamp, HammerStrike } from "./theatre/sold-stamp";
export type { SoldStampProps, StampTone, StampSize } from "./theatre/sold-stamp";
export { GoldDrift } from "./theatre/gold-drift";
export type { GoldDriftProps } from "./theatre/gold-drift";

export { paintOnFill, relativeLuminance, textOnFill } from "./identity/fill-contrast";
export type { FillPaint, FillTextToken } from "./identity/fill-contrast";
export { placeholderIdentity, initialsFor } from "./identity/placeholder";
export type { PlaceholderIdentity, PlaceholderPattern } from "./identity/placeholder";
export { PlayerImage } from "./identity/player-image";
export type { PlayerImageProps, PlayerImageSize } from "./identity/player-image";
export { ImageUploader, IMAGE_UPLOAD_ACCEPT, imageFileProblem } from "./identity/image-uploader";
export type { ImageUploaderProps, UploadOutcome } from "./identity/image-uploader";
export { PlayerCard } from "./identity/player-card";
export type { PlayerCardProps, PlayerRole, PlayerStatus } from "./identity/player-card";

// Shell kit (PX-2): the three product shells and their navigation/system parts.
export { AppShell, NavigationRail, NavigationGroup, NavigationItem } from "./shell/app-shell";
export type { AppShellProps, ShellNavItem } from "./shell/app-shell";
export { PublicShell } from "./shell/public-shell";
export type { PublicShellProps, PublicShellLink } from "./shell/public-shell";
export { LiveShell } from "./shell/live-shell";
export type { LiveShellProps } from "./shell/live-shell";
export { Breadcrumb } from "./shell/breadcrumb";
export type { BreadcrumbProps, BreadcrumbItem } from "./shell/breadcrumb";
export { PageHeader, PageIntro, SectionHeader, QuickActionBar } from "./shell/page-header";
export type {
  PageHeaderProps,
  PageIntroProps,
  SectionHeaderProps,
  QuickActionBarProps,
} from "./shell/page-header";
export { SubNavTabs } from "./shell/sub-nav-tabs";
export { useActiveInView } from "./primitives/use-active-in-view";
export type { SubNavTabsProps, SubNavTab } from "./shell/sub-nav-tabs";
export { PopoverMenu } from "./shell/popover-menu";
export type { PopoverMenuProps, PopoverMenuItem } from "./shell/popover-menu";
export { Drawer } from "./shell/drawer";
export type { DrawerProps } from "./shell/drawer";
export { InlineSearch } from "./shell/inline-search";
export type { InlineSearchProps, InlineSearchHandle } from "./shell/inline-search";
export { filterGroups } from "./shell/search-filter";
export type { PaletteGroup, PaletteItem } from "./shell/search-filter";
export { LoadingState } from "./shell/loading-state";
export type { LoadingStateProps } from "./shell/loading-state";
export { ErrorState } from "./primitives/error-state";
export type { ErrorStateProps } from "./primitives/error-state";
export { BrandGlyph } from "./shell/icons";
// The one icon set. Every glyph the product draws — shell, marketing, content.
export * from "./icons/icons";
// The sport glyphs live in their own module (see the note at its head).
export * from "./icons/sports";
