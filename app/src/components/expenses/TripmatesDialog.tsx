import { Icon } from "@iconify/react";
import archiveIcon from "@iconify-icons/lucide/archive";
import archiveRestoreIcon from "@iconify-icons/lucide/archive-restore";
import plusIcon from "@iconify-icons/lucide/plus";
import userIcon from "@iconify-icons/lucide/user";
import { useRef, useState } from "react";
import type * as Y from "yjs";
import { friendDropdownOption } from "~/components/tripmates/FriendName";
import { TripmateFields } from "~/components/tripmates/TripmateFields";
import { Dropdown } from "~/components/ui/Dropdown";
import { Modal } from "~/components/ui/Modal";
import modalStyles from "~/components/ui/Modal.module.css";
import { createTripmate, upsertFriends } from "~/features/collaboration/document";
import type { Friend } from "~/features/expense/model";
import { useTripText } from "~/features/trip/language";
import type { TripSnapshot } from "~/features/trip/model";
import styles from "./ExpensesWorkspace.module.css";

const friendColors = ["#087e9f", "#9560a6", "#b06235", "#437e5d", "#a94e75", "#566fb1"] as const;

type FriendDraft = Pick<Friend, "name" | "color" | "archived">;

export function TripmatesDialog({
  document,
  snapshot,
  selectedFriendId,
  onSelectFriend,
  onClose,
}: {
  document: Y.Doc;
  snapshot: TripSnapshot;
  selectedFriendId: string | null;
  onSelectFriend: (id: string | null) => void;
  onClose: () => void;
}) {
  const text = useTripText();
  const [drafts, setDrafts] = useState<Record<string, FriendDraft>>({});
  const [selectedDraft, setSelectedDraft] = useState(selectedFriendId);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState("");
  const friends = Object.values(snapshot.friends).sort((a, b) => a.name.localeCompare(b.name));
  const activeFriends: Friend[] = [];
  const archivedFriends: Friend[] = [];
  for (const friend of friends) {
    if (drafts[friend.id]?.archived ?? friend.archived) archivedFriends.push(friend);
    else activeFriends.push(friend);
  }
  const changedFriends: Friend[] = [];
  for (const friend of friends) {
    const draft = drafts[friend.id];
    if (!draft) continue;
    const name = draft.name.trim();
    if (
      name !== friend.name ||
      draft.color !== friend.color ||
      draft.archived !== friend.archived
    ) {
      changedFriends.push({ ...friend, ...draft, name });
    }
  }
  const canSave =
    (changedFriends.length > 0 || selectedDraft !== selectedFriendId) &&
    changedFriends.every((friend) => friend.name.length > 0);
  const save = () => {
    if (!canSave) return;
    try {
      upsertFriends(document, changedFriends);
      if (selectedDraft !== selectedFriendId) onSelectFriend(selectedDraft);
      onClose();
    } catch {
      setError(text("expenseSaveFailed"));
    }
  };
  const renderFriend = (friend: Friend) => (
    <FriendRow
      key={friend.id}
      friend={friend}
      draft={drafts[friend.id] ?? friend}
      onChange={(draft) => setDrafts((current) => ({ ...current, [friend.id]: draft }))}
      onArchive={() => {
        const draft = drafts[friend.id] ?? friend;
        setDrafts((current) => ({
          ...current,
          [friend.id]: { ...draft, archived: !draft.archived },
        }));
        if (selectedDraft === friend.id && !draft.archived) setSelectedDraft(null);
      }}
    />
  );
  return (
    <>
      <Modal title={text("tripmates")} onClose={onClose}>
        <div className={styles.friendIdentity}>
          <div className="field">
            <span>{text("tripmateIdentity")}</span>
            <Dropdown
              label={text("tripmateIdentity")}
              value={selectedDraft ?? ""}
              options={[
                {
                  value: "",
                  label: text("tripmateGuest"),
                  icon: <Icon icon={userIcon} aria-hidden="true" />,
                },
                ...activeFriends.map(friendDropdownOption),
              ]}
              onChange={(id) => setSelectedDraft(id || null)}
            />
          </div>
        </div>
        <div className={styles.friendList}>
          {activeFriends.map(renderFriend)}
          {archivedFriends.length > 0 ? (
            <details className={styles.archivedFriends}>
              <summary className={styles.archivedSummary}>{text("expenseArchivedUsers")}</summary>
              <div className={styles.archivedRows}>{archivedFriends.map(renderFriend)}</div>
            </details>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="field-error">
            {error}
          </p>
        ) : null}
        <div className={modalStyles.actions}>
          <button type="button" className="secondary-button" onClick={() => setAddOpen(true)}>
            <Icon icon={plusIcon} aria-hidden="true" /> {text("expenseAddTripmate")}
          </button>
          <button type="button" className="primary-button" disabled={!canSave} onClick={save}>
            {text("expenseSave")}
          </button>
        </div>
      </Modal>
      {addOpen ? (
        <AddTripmateDialog
          document={document}
          nextColor={friendColors[friends.length % friendColors.length] ?? friendColors[0]}
          reservedNames={friends.map((friend) =>
            (drafts[friend.id]?.name ?? friend.name).trim().toLowerCase(),
          )}
          onClose={() => setAddOpen(false)}
        />
      ) : null}
    </>
  );
}

function AddTripmateDialog({
  document,
  nextColor,
  reservedNames,
  onClose,
}: {
  document: Y.Doc;
  nextColor: string;
  reservedNames: readonly string[];
  onClose: () => void;
}) {
  const text = useTripText();
  const [name, setName] = useState("");
  const [color, setColor] = useState(nextColor);
  const [error, setError] = useState("");
  return (
    <Modal title={text("expenseNewTripmate")} onClose={onClose} stacked>
      <form
        className={modalStyles.form}
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (!trimmed) return;
          if (reservedNames.includes(trimmed.toLowerCase())) {
            setError(text("tripmateJoinNameExists"));
            return;
          }
          try {
            createTripmate(document, {
              id: crypto.randomUUID(),
              name: trimmed,
              color,
              archived: false,
            });
            onClose();
          } catch {
            setError(text("expenseSaveFailed"));
          }
        }}
      >
        <TripmateFields
          name={name}
          color={color}
          nameLabel={text("expenseName")}
          colorLabel={text("expenseColor")}
          placeholder={text("tripmateJoinName")}
          required
          maxLength={100}
          onNameChange={(value) => {
            setName(value);
            setError("");
          }}
          onColorChange={setColor}
        />
        {error ? (
          <p role="alert" className="field-error">
            {error}
          </p>
        ) : null}
        <div className={modalStyles.actions}>
          <button type="button" className="secondary-button" onClick={onClose}>
            {text("cancel")}
          </button>
          <button type="submit" className="primary-button" disabled={!name.trim()}>
            {text("expenseSave")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function FriendRow({
  friend,
  draft,
  onChange,
  onArchive,
}: {
  friend: Friend;
  draft: FriendDraft;
  onChange: (draft: FriendDraft) => void;
  onArchive: () => void;
}) {
  const text = useTripText();
  const initialName = useRef(draft.name);
  const cancelled = useRef(false);

  const finishNameEdit = () => {
    const name = cancelled.current ? initialName.current : draft.name.trim() || initialName.current;
    cancelled.current = false;
    onChange({ ...draft, name });
  };

  return (
    <div className={styles.friendRow}>
      <TripmateFields
        name={draft.name}
        color={draft.color}
        nameLabel={text("expenseNameForTripmate", { name: friend.name })}
        colorLabel={text("expenseColorForTripmate", { name: friend.name })}
        aria-invalid={!draft.name.trim()}
        maxLength={100}
        onNameChange={(name) => onChange({ ...draft, name })}
        onColorChange={(color) => onChange({ ...draft, color })}
        onFocus={() => {
          initialName.current = draft.name;
          cancelled.current = false;
        }}
        onBlur={finishNameEdit}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter" || event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancelled.current = event.key === "Escape";
            event.currentTarget.blur();
          }
        }}
      >
        <button
          type="button"
          className={`${styles.friendArchiveButton} ghost-button icon-button`}
          aria-label={`${text(draft.archived ? "expenseRestore" : "expenseArchive")} ${draft.name}`}
          title={`${text(draft.archived ? "expenseRestore" : "expenseArchive")} ${draft.name}`}
          onClick={onArchive}
        >
          <Icon icon={draft.archived ? archiveRestoreIcon : archiveIcon} aria-hidden="true" />
        </button>
      </TripmateFields>
      {!draft.name.trim() ? <p className="field-error">{text("expenseEnterName")}</p> : null}
    </div>
  );
}
