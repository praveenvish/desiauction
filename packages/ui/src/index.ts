// FLOODLIGHT design system. M-IP1-1 tokens + M-IP1-2 primitives (IP-1_DESIGN §9).
export { tokens, semanticTokenNames } from "./generated/tokens";
export type { SemanticToken } from "./generated/tokens";

export { Button, ButtonLink, buttonClassName } from "./primitives/button";
export type { ButtonProps, ButtonLinkProps, ButtonVariant, ButtonSize } from "./primitives/button";
export { Badge } from "./primitives/badge";
export type { BadgeProps, BadgeTone } from "./primitives/badge";
export { Card } from "./primitives/card";
export type { CardProps } from "./primitives/card";
export { Money } from "./primitives/money";
export type { MoneyProps, MoneyTone } from "./primitives/money";
export { Skeleton } from "./primitives/skeleton";
export type { SkeletonProps } from "./primitives/skeleton";
export { EmptyState } from "./primitives/empty-state";
export type { EmptyStateProps } from "./primitives/empty-state";
export { Field, Select } from "./primitives/field";
export type { FieldProps, SelectProps } from "./primitives/field";
export { Tabs } from "./primitives/tabs";
export type { TabsProps, TabItem } from "./primitives/tabs";
export { Dialog } from "./primitives/dialog";
export type { DialogProps } from "./primitives/dialog";
export { ToastProvider, useToast } from "./primitives/toast";
export type { ToastOptions, ToastTone } from "./primitives/toast";

export { useHoldGate } from "./motion/use-hold-gate";
export type { HoldGate, HoldGateBind, HoldGateOptions } from "./motion/use-hold-gate";
export { AnnouncerProvider, useAnnouncer } from "./live/announcer";
export type { Announce, AnnounceChannel } from "./live/announcer";
export { VisuallyHidden } from "./live/visually-hidden";

export { placeholderIdentity, initialsFor } from "./identity/placeholder";
export type { PlaceholderIdentity, PlaceholderPattern } from "./identity/placeholder";
export { PlayerImage } from "./identity/player-image";
export type { PlayerImageProps, PlayerImageSize } from "./identity/player-image";
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
export { PageHeader, SectionHeader, QuickActionBar } from "./shell/page-header";
export type { PageHeaderProps, SectionHeaderProps, QuickActionBarProps } from "./shell/page-header";
export { SubNavTabs, ContextBar } from "./shell/sub-nav-tabs";
export type { SubNavTabsProps, SubNavTab, ContextBarProps } from "./shell/sub-nav-tabs";
export { PopoverMenu } from "./shell/popover-menu";
export type { PopoverMenuProps, PopoverMenuItem } from "./shell/popover-menu";
export { Drawer } from "./shell/drawer";
export type { DrawerProps } from "./shell/drawer";
export { CommandPalette } from "./shell/command-palette";
export type { CommandPaletteProps, PaletteGroup, PaletteItem } from "./shell/command-palette";
export { LoadingState } from "./shell/loading-state";
export type { LoadingStateProps } from "./shell/loading-state";
export { ErrorState } from "./primitives/error-state";
export type { ErrorStateProps } from "./primitives/error-state";
export {
  IconHome,
  IconTrophy,
  IconUsers,
  IconRupee,
  IconHelp,
  IconSearch,
  IconBell,
  IconMenu,
  IconClose,
  IconChevronDown,
  IconArrowLeft,
  IconAlert,
} from "./shell/icons";
