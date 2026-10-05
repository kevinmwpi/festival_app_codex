import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, layout, radii, spacing } from './theme';

export type ToastTone = 'neutral' | 'success' | 'error';

interface ToastMessage {
  id: number;
  message: string;
  tone: ToastTone;
}

type ToastListener = (toast: ToastMessage) => void;

const MAX_QUEUED = 3;
const ENTER_MS = 220;
const EXIT_MS = 180;

const listeners = new Set<ToastListener>();
/** Toasts raised before any `ToastHost` mounted (e.g. during launch); shown once one mounts. */
let pendingBeforeHost: ToastMessage[] = [];
let nextToastId = 1;

/**
 * Appends `toast` and trims the queue to `MAX_QUEUED`. The toast on screen (index 0 when
 * `headVisible`) is never dropped; otherwise the oldest waiting non-error toast goes first (the new
 * toast included), and only a queue of nothing but errors loses its oldest waiting error. So a fresh
 * error is never lost behind earlier "saved" toasts, and newer news wins over older news.
 */
function enqueue(queue: ToastMessage[], toast: ToastMessage, headVisible: boolean): ToastMessage[] {
  const next = [...queue, toast];
  const firstDroppable = headVisible ? 1 : 0;
  while (next.length > MAX_QUEUED) {
    let dropIndex = next.findIndex((item, index) => index >= firstDroppable && item.tone !== 'error');
    if (dropIndex === -1) {
      dropIndex = firstDroppable;
    }
    next.splice(dropIndex, 1);
  }
  return next;
}

/**
 * Shows a short message at the bottom of the screen and announces it to VoiceOver/TalkBack.
 * Safe to call from anywhere (event handlers, sync listeners, outside React). Needs one
 * `<ToastHost />` mounted near the app root (`AppProviders` mounts it).
 */
export function showToast(message: string, tone: ToastTone = 'neutral'): void {
  const text = message.trim();
  if (!text) {
    return;
  }

  const toast: ToastMessage = { id: nextToastId++, message: text, tone };
  if (listeners.size === 0) {
    pendingBeforeHost = enqueue(pendingBeforeHost, toast, false);
    return;
  }

  listeners.forEach((listener) => listener(toast));
}

/** Visible time grows with length so longer copy can be read: 2.5–6 s. */
function visibleDurationMs(message: string): number {
  return Math.min(6_000, Math.max(2_500, 1_500 + message.length * 50));
}

const TONE_STYLES: Record<ToastTone, { backgroundColor: string; color: string; dot: string }> = {
  neutral: { backgroundColor: colors.surface, color: colors.textPrimary, dot: colors.primary },
  success: { backgroundColor: colors.successBg, color: '#1F5C2E', dot: colors.success },
  error: { backgroundColor: colors.destructiveBg, color: colors.destructive, dot: colors.destructive },
};

/**
 * Renders queued toasts one at a time (fade + slide, auto-dismiss, tap to dismiss). Mount once,
 * as the last child of the app root so it draws above screens.
 *
 * @param bottomOffset distance from the bottom edge; defaults to `layout.tabBarClearance` so the
 *   toast floats above the tab bar.
 */
export function ToastHost({ bottomOffset = layout.tabBarClearance }: { bottomOffset?: number }) {
  const [queue, setQueue] = useState<ToastMessage[]>([]);
  const progress = useRef(new Animated.Value(0)).current;
  const reduceMotion = useRef(false);
  const current = queue[0] ?? null;

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) reduceMotion.current = enabled;
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      reduceMotion.current = enabled;
    });

    const listener: ToastListener = (toast) => {
      setQueue((previous) => {
        // Drop exact repeats of a toast that is already showing or waiting.
        if (previous.some((item) => item.message === toast.message && item.tone === toast.tone)) {
          return previous;
        }
        return enqueue(previous, toast, true);
      });
    };
    listeners.add(listener);
    if (pendingBeforeHost.length > 0) {
      const early = pendingBeforeHost;
      pendingBeforeHost = [];
      early.forEach(listener);
    }

    return () => {
      mounted = false;
      listeners.delete(listener);
      subscription.remove();
    };
  }, []);

  const dismissCurrent = useCallback(
    (id: number) => {
      Animated.timing(progress, { toValue: 0, duration: EXIT_MS, useNativeDriver: true }).start(() => {
        setQueue((previous) => (previous[0]?.id === id ? previous.slice(1) : previous));
      });
    },
    [progress],
  );

  useEffect(() => {
    if (!current) {
      return;
    }

    AccessibilityInfo.announceForAccessibility(current.message);
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: ENTER_MS, useNativeDriver: true }).start();
    const timer = setTimeout(() => dismissCurrent(current.id), visibleDurationMs(current.message));
    return () => clearTimeout(timer);
  }, [current, dismissCurrent, progress]);

  if (!current) {
    return null;
  }

  const tone = TONE_STYLES[current.tone];
  const translateY = reduceMotion.current
    ? 0
    : progress.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });

  return (
    <View pointerEvents="box-none" style={[styles.host, { bottom: bottomOffset }]}>
      <Animated.View style={{ opacity: progress, transform: [{ translateY }] }}>
        <Pressable
          onPress={() => dismissCurrent(current.id)}
          accessibilityRole="alert"
          accessibilityLabel={current.message}
          accessibilityHint="Double-tap to dismiss"
          style={[styles.toast, { backgroundColor: tone.backgroundColor }]}
        >
          <View style={[styles.dot, { backgroundColor: tone.dot }]} />
          <Text style={[styles.message, { color: tone.color }]}>{current.message}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    alignItems: 'center',
    left: spacing.md,
    position: 'absolute',
    right: spacing.md,
  },
  toast: {
    alignItems: 'center',
    borderColor: colors.borderCard,
    borderRadius: radii.xl,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm + 2,
    maxWidth: 520,
    minHeight: layout.minTouchTarget,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 6,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  dot: { borderRadius: 4, height: 8, width: 8 },
  message: { flexShrink: 1, fontSize: 14, fontWeight: '600', lineHeight: 20 },
});
