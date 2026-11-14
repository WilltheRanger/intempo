import { TextAction } from './TextAction';

export interface RevealPasswordActionProps {
  revealed: boolean;
  onPress: () => void;
}

/**
 * The Show/Hide control beside a password field.
 *
 * **One copy, because there were three screens and only two had it.** The
 * sign-in screen and the change-password screen each carried their own; the
 * *set-password* screen — where someone who has just followed a reset link
 * types a brand-new password twice on a phone keyboard, with no way to check
 * either — had none. That is the screen it helps most and it was the one
 * without it.
 *
 * Where a screen has two new-password fields it belongs on the first and
 * governs both: one tap reveals the pair, because the second field exists to
 * catch a typo in the first and hiding one while showing the other would be a
 * strange thing to offer.
 */
export function RevealPasswordAction({
  revealed,
  onPress,
}: RevealPasswordActionProps) {
  return (
    <TextAction
      label={revealed ? 'Hide' : 'Show'}
      size="small"
      accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
      onPress={onPress}
    />
  );
}
