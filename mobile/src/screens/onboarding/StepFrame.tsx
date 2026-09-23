import { useEffect, useRef, type ReactNode } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { ChevronLeft } from '../../components/icons';
import {
  IconButton,
  PrimaryButton,
  ScreenContainer,
  Text,
} from '../../components/primitives';
import { colors, EASE_OUT, MIN_TOUCH_TARGET, motion, spacing } from '../../design';
import { ONBOARDING_STEPS, stepNumber, type OnboardingStep } from '../../lib/onboardingSteps';
import { useReducedMotion } from '../../lib/useReducedMotion';
import { sceneOffset, type SceneDirection } from '../../navigation/sceneMotion';

export interface StepAction {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}

export interface StepFrameProps {
  step: OnboardingStep;
  /** Which way the musician arrived, so the step slides in from that side. */
  direction: SceneDirection;
  title: string;
  lede: string;
  onBack: () => void;
  primary: StepAction;
  /** The quiet line under the button: "Not now", "Do this later". */
  secondary?: StepAction;
  /** Why the last attempt did not go through, under the answer. */
  error?: string | null;
  children: ReactNode;
}

/**
 * One onboarding question (`redesign/OnboardName.dc.html` and the five after
 * it): back and the six-segment bar across the top, the question in the
 * screen-title serif, one line on why it is asked, the answer, and the button
 * in the thumb zone.
 *
 * **The same frame six times**, because the screens are the same composition
 * with a different answer in the middle — the prototypes are six copies of one
 * layout, and six copies here would be six places for the margin under a title
 * to drift.
 *
 * The three-foot test, for every step: the question first, the answer second,
 * Next third. The bar and the back chevron recede on purpose — they are where
 * you are, not what to do.
 */
export function StepFrame({
  step,
  direction,
  title,
  lede,
  onBack,
  primary,
  secondary,
  error = null,
  children,
}: StepFrameProps) {
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      // The name step's field sits under the title; without this its Next
      // button is behind the keyboard on a shorter phone.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenContainer
        footer={
          <View>
            <PrimaryButton
              label={primary.label}
              onPress={primary.onPress}
              disabled={primary.disabled || primary.loading}
              loading={primary.loading}
            />
            {secondary ? <QuietAction {...secondary} /> : null}
          </View>
        }
      >
        <View style={styles.top}>
          <IconButton
            icon={ChevronLeft}
            label="Back"
            variant="bare"
            onPress={onBack}
            style={styles.back}
          />
          <StepProgress step={step} />
        </View>

        <StepEntrance id={step} direction={direction}>
          <Text variant="screenTitle" accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <Text variant="body" color="textSecondary" style={styles.lede}>
            {lede}
          </Text>
          <View style={styles.answer}>{children}</View>
          {error ? (
            <Text variant="metadataSmall" color="textSecondary" style={styles.error}>
              {error}
            </Text>
          ) : null}
        </StepEntrance>
      </ScreenContainer>
    </KeyboardAvoidingView>
  );
}

/** Six segments, gold up to and including this step. */
function StepProgress({ step }: { step: OnboardingStep }) {
  const at = stepNumber(step);
  const of = ONBOARDING_STEPS.length;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${at} of ${of}`}
      accessibilityValue={{ min: 1, max: of, now: at }}
      style={styles.progress}
    >
      {ONBOARDING_STEPS.map((each, index) => (
        <View key={each} style={[styles.segment, index < at && styles.segmentDone]} />
      ))}
    </View>
  );
}

/**
 * The step's own content arriving from the side it was reached from.
 *
 * Only the question moves. The bar stays put and fills, which is what tells
 * you the step changed; sliding it with everything else would make it look
 * like a new bar every time.
 */
function StepEntrance({
  id,
  direction,
  children,
}: {
  id: string;
  direction: SceneDirection;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduceMotion || direction === 'none') {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: motion.push,
      easing: EASE_OUT,
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [id, direction, reduceMotion, progress]);

  const offset = sceneOffset(direction);
  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] }) },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

/**
 * The second, quieter way out of a screen: "Not now", "Do this later",
 * "I already have an account". Text at a full touch target, under the button,
 * so the button stays the one thing to do.
 */
export function QuietAction({ label, onPress, disabled = false }: StepAction) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.quiet, pressed && styles.quietPressed]}
    >
      <Text variant="metadata" color="textTertiary">
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    // The prototype's 12, plus the 12 the back target now reaches further
    // into the gutter, so the bar still starts where it was drawn.
    gap: spacing['2xl'],
    marginTop: spacing.lg,
  },
  back: {
    // The chevron's ink on the margin, under the title's first letter, as the
    // prototype has it — the 44pt target reaching out into the gutter rather
    // than pushing the glyph in.
    marginLeft: -22,
    flexShrink: 0,
  },
  progress: {
    flex: 1,
    flexDirection: 'row',
    gap: 5,
  },
  segment: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  segmentDone: {
    backgroundColor: colors.accent,
  },
  title: {
    marginTop: 26,
  },
  lede: {
    marginTop: 10,
  },
  answer: {
    marginTop: 30,
  },
  error: {
    marginTop: spacing.lg,
  },
  quiet: {
    minHeight: MIN_TOUCH_TARGET,
    marginTop: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quietPressed: {
    opacity: 0.55,
  },
});
