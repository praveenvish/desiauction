import type { ComponentType } from "react";
import {
  IconArrowRight as UiArrowRight,
  IconBolt as UiBolt,
  IconBroadcast as UiBroadcast,
  IconCalendar as UiCalendar,
  IconCamera as UiCamera,
  IconCheck as UiCheck,
  IconFileCheck as UiFileCheck,
  IconGavel as UiGavel,
  IconGlobe as UiGlobe,
  IconLedger as UiLedger,
  IconLock as UiLock,
  IconPin as UiPin,
  IconMessageCircle as UiMessageCircle,
  IconPhone as UiPhone,
  IconPlay as UiPlay,
  IconReceipt as UiReceipt,
  IconRefresh as UiRefresh,
  IconRupee as UiRupee,
  IconSearch as UiSearch,
  IconShieldCheck as UiShieldCheck,
  IconSpark as UiSpark,
  IconStar as UiStar,
  IconTrophy as UiTrophy,
  IconTv as UiTv,
  IconUsers as UiUsers,
  type IconProps,
} from "@desiauction/ui";

/**
 * The marketing surfaces draw from the same icon set as the shell now
 * (`@desiauction/ui`). This module keeps the names the public pages import
 * and only changes the default size: marketing tiles render at 24px where
 * console chrome renders at 20. Every glyph still inherits `currentColor`.
 */
function at24(Icon: ComponentType<IconProps>): ComponentType<IconProps> {
  return function MarketingIcon(props: IconProps) {
    return <Icon size={24} {...props} />;
  };
}

export const IconShieldCheck = at24(UiShieldCheck);
export const IconLedger = at24(UiLedger);
export const IconBolt = at24(UiBolt);
export const IconGavel = at24(UiGavel);
export const IconBroadcast = at24(UiBroadcast);
export const IconTv = at24(UiTv);
export const IconPhone = at24(UiPhone);
export const IconRupee = at24(UiRupee);
export const IconReceipt = at24(UiReceipt);
export const IconTrophy = at24(UiTrophy);
export const IconUsers = at24(UiUsers);
export const IconRefresh = at24(UiRefresh);
export const IconLock = at24(UiLock);
export const IconCheck = at24(UiCheck);
export const IconArrowRight = at24(UiArrowRight);
export const IconMapPin = at24(UiPin);
export const IconCalendar = at24(UiCalendar);
export const IconSearch = at24(UiSearch);
export const IconFileCheck = at24(UiFileCheck);
export const IconSpark = at24(UiSpark);
export const IconStar = at24(UiStar);
export const IconPlay = at24(UiPlay);
export const IconCamera = at24(UiCamera);
export const IconMessageCircle = at24(UiMessageCircle);
export const IconGlobe = at24(UiGlobe);
