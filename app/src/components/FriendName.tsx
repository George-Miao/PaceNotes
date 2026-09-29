import type { Friend } from "~/features/expense/model";
import { useTripText } from "~/features/trip/language";
import type { DropdownOption } from "./Dropdown";
import styles from "./FriendName.module.css";

export function FriendDot({ color }: { color: string }) {
  return <span className={styles.dot} style={{ backgroundColor: color }} aria-hidden="true" />;
}

export function FriendName({ friend }: { friend: Friend }) {
  const text = useTripText();
  return (
    <span className={styles.name}>
      <FriendDot color={friend.color} />
      <span>
        {friend.name}
        {friend.archived ? <small>{text("expenseArchivedName", { name: "" })}</small> : null}
      </span>
    </span>
  );
}

export function friendDropdownOption(friend: Friend): DropdownOption {
  return {
    value: friend.id,
    label: friend.name,
    icon: <FriendDot color={friend.color} />,
  };
}
