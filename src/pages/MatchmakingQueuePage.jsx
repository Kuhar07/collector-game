import { useEffect, useMemo, useState } from 'react';
import { useHistory, useLocation, useParams } from 'react-router-dom';
import {
    IonPage,
    IonContent,
    IonButton,
    IonIcon,
    IonSpinner
} from '@ionic/react';
import { closeCircleOutline } from 'ionicons/icons';
import AppHeader from '../components/AppHeader';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import {
    enqueueForMatch,
    listenForMatch,
    tryFindMatch,
    cancelMatchmaking,
    heartbeatMatchmaking
} from '../hooks/matchmakingService';
import { validateGame } from '../hooks/matchmakingService';

function useQuery() {
    return new URLSearchParams(useLocation().search);
}

export default function MatchmakingQueuePage() {
    const { t } = useI18n();
    const { user, loading } = useAuth();
    const history = useHistory();
    const { mode } = useParams();
    const query = useQuery();
    const [error, setError] = useState('');
    const [cancelling, setCancelling] = useState(false);

    const safeMode = useMemo(
        () => (mode === 'ranked' || mode === 'casual' ? mode : 'casual'),
        [mode]
    );

    const casualGridSize = Number(query.get('gridSize')) || 6;
    const casualTimerEnabled = query.get('timer') === '1';

    useEffect(() => {
        if (!loading && !user) history.replace('/online/auth');
    }, [loading, user, history]);

    useEffect(() => {
        if (!user) return undefined;

        let active = true;
        let trying = false;
        let unsubscribe = () => { };
        let retryTimer = null;
        let heartbeatTimer = null;
        let lastRedirectedGameId = null; // Track to avoid redirecting twice to same game

        const attemptMatch = async () => {
            if (trying) return;
            trying = true;
            try {
                const gameId = await tryFindMatch({ userId: user.uid, mode: safeMode });
                if (active && gameId) {
                    // validate backend that this user is actually a participant in the game
                    const ok = await validateGame({ gameId });
                    if (ok) history.replace(`/online/game/${gameId}`);
                }
            } catch (_) {
                // Keep searching; transient failures should not stop queue retries.
            } finally {
                trying = false;
            }
        };

        const start = async () => {
            try {
                const isRanked = safeMode === 'ranked';
                // Always cancel any previous matchmaking to clear stale queue state
                await cancelMatchmaking(user.uid, safeMode);
                // Wait a moment for deletion to propagate through Firestore
                await new Promise((resolve) => setTimeout(resolve, 500));

                await enqueueForMatch({
                    user,
                    mode: safeMode,
                    gridSize: isRanked ? 8 : casualGridSize,
                    timerEnabled: isRanked ? true : casualTimerEnabled
                });

                unsubscribe = listenForMatch(user.uid, safeMode, async (queueEntry) => {
                    if (!active || !queueEntry) return;
                    if (queueEntry.status === 'matched' && queueEntry.gameId) {
                        // Avoid redirecting to same game twice (prevents listener from firing on cached state)
                        if (queueEntry.gameId !== lastRedirectedGameId) {
                            lastRedirectedGameId = queueEntry.gameId;
                            // validate before navigating
                            try {
                                const ok = await validateGame({ gameId: queueEntry.gameId });
                                if (ok) history.replace(`/online/game/${queueEntry.gameId}`);
                            } catch (e) {
                                // ignore invalid or transient errors
                            }
                        }
                    }
                });

                await attemptMatch();

                // Re-run matchmaking regularly so ranked range widening over time can take effect.
                retryTimer = window.setInterval(() => {
                    void attemptMatch();
                }, 3000);

                // Heartbeat keeps the queue entry alive so it isn't pruned as stale.
                heartbeatTimer = window.setInterval(() => {
                    if (!active) return;
                    void heartbeatMatchmaking(safeMode).catch(() => { });
                }, 10000);
            } catch (e) {
                if (active) setError(e.message || t('lobby.matchmaking_error'));
            }
        };

        start();

        return () => {
            active = false;
            unsubscribe();
            if (retryTimer) window.clearInterval(retryTimer);
            if (heartbeatTimer) window.clearInterval(heartbeatTimer);
        };
    }, [
        user,
        safeMode,
        casualGridSize,
        casualTimerEnabled,
        history,
        t
    ]);

    const cancel = async () => {
        if (!user || cancelling) {
            history.replace('/online/lobby');
            return;
        }
        setCancelling(true);
        try {
            await cancelMatchmaking(user.uid, safeMode);
        } catch (_) {
            // Ignore cancellation errors and return to lobby.
        } finally {
            history.replace('/online/lobby');
        }
    };

    const modeLabel =
        safeMode === 'ranked' ? t('lobby.matchmaking_ranked') : t('lobby.matchmaking_casual');

    return (
        <IonPage>
            <AppHeader title={t('app_title')} />
            <IonContent fullscreen>
                <div className="sk-menu-content">
                    <div className="sk-lobby-panel">
                        <p style={{ textAlign: 'center', marginTop: 0, fontWeight: 700 }}>
                            {t('lobby.matchmaking_title')}
                        </p>
                        <p style={{ textAlign: 'center', marginTop: 2 }}>{modeLabel}</p>
                        <div style={{ textAlign: 'center', margin: '12px 0' }}>
                            <IonSpinner />
                        </div>
                        <p style={{ textAlign: 'center', marginBottom: 0 }}>
                            {t('lobby.matchmaking_searching')}
                        </p>
                        {error && <p style={{ color: '#dc3545', marginTop: 10 }}>{error}</p>}
                        <div className="sk-row-buttons">
                            <IonButton fill="outline" color="medium" onClick={cancel}>
                                <IonIcon slot="start" icon={closeCircleOutline} />
                                {t('lobby.cancel_button')}
                            </IonButton>
                        </div>
                    </div>
                </div>
            </IonContent>
        </IonPage>
    );
}
