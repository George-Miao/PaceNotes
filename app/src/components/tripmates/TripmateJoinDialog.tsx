import { useRef, useState } from "react";
import { Modal } from "~/components/ui/Modal";
import modalStyles from "~/components/ui/Modal.module.css";
import type { Friend } from "~/features/expense/model";
import { useTripText } from "~/features/trip/language";
import { FriendName } from "./FriendName";
import { TripmateFields } from "./TripmateFields";
import styles from "./TripmateJoinDialog.module.css";

const colors = ["#087e9f", "#9560a6", "#b06235", "#437e5d", "#a94e75", "#566fb1"];

export function TripmateJoinDialog({
  friends,
  onSelect,
  onCreate,
  onLater,
}: {
  friends: Record<string, Friend>;
  onSelect: (id: string) => void;
  onCreate: (name: string, color: string) => void;
  onLater: () => void;
}) {
  const text = useTripText();
  const active = Object.values(friends)
    .filter((friend) => !friend.archived)
    .sort((left, right) => left.name.localeCompare(right.name));
  const [name, setName] = useState("");
  const [color, setColor] = useState(
    colors[Object.keys(friends).length % colors.length] ?? "#087e9f",
  );
  const [error, setError] = useState("");
  const firstChoiceRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  return (
    <Modal
      title={text("tripmateJoinTitle")}
      onClose={onLater}
      initialFocus={active.length ? firstChoiceRef : nameRef}
    >
      <p>{text("tripmateJoinIntro")}</p>
      {active.length ? (
        <div className={styles.choices}>
          {active.map((friend, index) => (
            <button
              key={friend.id}
              type="button"
              className="secondary-button"
              ref={index === 0 ? firstChoiceRef : undefined}
              onClick={() => onSelect(friend.id)}
            >
              <FriendName friend={friend} />
            </button>
          ))}
        </div>
      ) : null}
      <form
        className={styles.create}
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          try {
            onCreate(name.trim(), color);
            setError("");
          } catch (cause) {
            setError(
              cause instanceof Error && cause.message === "A tripmate with this name already exists"
                ? text("tripmateJoinNameExists")
                : text("tripmateJoinCreateFailed"),
            );
          }
        }}
      >
        <h3 className={styles.createTitle}>{text("tripmateJoinNewTripmate")}</h3>
        <TripmateFields
          ref={nameRef}
          name={name}
          color={color}
          nameLabel={text("tripmateJoinNewTripmate")}
          colorLabel={text("tripmateJoinColorLabel")}
          required
          maxLength={100}
          placeholder={text("tripmateJoinName")}
          onNameChange={(value) => {
            setName(value);
            setError("");
          }}
          onColorChange={setColor}
        />
        <div className={modalStyles.actions}>
          <button type="button" className="secondary-button" onClick={onLater}>
            {text("tripmateJoinLater")}
          </button>
          <button type="submit" className="primary-button">
            {text("tripmateJoinCreate")}
          </button>
        </div>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
