import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useState } from 'react';
import { Linking, Platform } from 'react-native';

import { Camera } from '../../components/icons';
import { EmptyState } from '../../components/primitives/EmptyState';
import { PageHeader } from '../../components/primitives/PageHeader';
import { ScreenContainer } from '../../components/primitives/ScreenContainer';
import {
  intentFromParams,
  launcherCopy,
  type CameraProblem,
  type LauncherRoute,
} from '../../lib/scan/pagePhoto';
import type { RootNavigation, RootStackParamList } from '../../navigation/types';
import { useGoBack } from '../../navigation/useGoBack';
import { usePageCamera } from '../../navigation/usePageCamera';

/**
 * The scan screen. **There is no viewfinder here any more.**
 *
 * Photographing a page opens the phone's own camera and keeps the whole
 * photograph at the camera's shape. The viewfinder this replaced drew the live
 * video into a page-shaped window and cropped every photograph to it, which a
 * musician reported as "it crops it really weirdly" — and asked for the actual
 * camera instead (2026-10-23). See `lib/scan/systemCamera.ts`.
 *
 * Every button that photographs a page opens the camera itself, inside the
 * tap, so a scan normally goes straight from the camera to the review list and
 * never passes through here. This is what `/scan` opens to, and where a camera
 * that gave nothing back — or an app build refused the camera permission —
 * says so and offers the way round it.
 */
export function ScannerScreen() {
  const navigation = useNavigation<RootNavigation>();
  const goBack = useGoBack({ tab: 'Library' });
  const route = useRoute<RouteProp<RootStackParamList, 'Scanner'>>();
  const photograph = usePageCamera();
  const [problem, setProblem] = useState<CameraProblem | null>(
    route.params?.problem ?? null,
  );
  const intent = intentFromParams(route.params);
  const copy = launcherCopy(problem, Platform.OS);

  function go(to: LauncherRoute) {
    if (to === 'camera') {
      // Straight from the press: on the web this is the tap that opens it.
      photograph(intent, { replace: true, onProblem: setProblem });
      return;
    }
    if (to === 'settings') {
      void Linking.openSettings().catch(() => setProblem('refused'));
      return;
    }
    navigation.navigate('AddPiece', {
      option: 'import',
      adding: intent.kind !== 'new',
      // A piece entered by hand that this scan was opened for keeps it.
      ...(intent.kind === 'new' && intent.attachToPieceId
        ? { attachToPieceId: intent.attachToPieceId }
        : {}),
    });
  }

  return (
    <ScreenContainer>
      <PageHeader onBack={goBack} backLabel="Back" />
      <EmptyState
        fill
        icon={Camera}
        title={copy.title}
        description={copy.description ?? undefined}
        hint={copy.hint ?? undefined}
        actionLabel={copy.primary.label}
        actionTone="primary"
        onActionPress={() => go(copy.primary.route)}
        secondaryLabel={copy.secondary.label}
        onSecondaryPress={() => go(copy.secondary.route)}
      />
    </ScreenContainer>
  );
}
