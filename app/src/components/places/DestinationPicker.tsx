import type { GooglePlaceSelection } from "~/features/google/google";
import { GooglePlacePicker } from "./GooglePlacePicker";

export type DestinationPickerProps = {
  label: string;
  onSelect: (place: GooglePlaceSelection) => void;
};

export function DestinationPicker({ label, onSelect }: DestinationPickerProps) {
  return <GooglePlacePicker label={label} onSelect={onSelect} />;
}
