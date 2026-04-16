import { useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import {
  IonPage,
  IonContent,
  IonButton,
  IonAlert,
  IonIcon
} from '@ionic/react';
import { homeOutline, refreshOutline } from 'ionicons/icons';
import AppHeader from '../components/AppHeader';
import GameBoard from '../components/GameBoard';
import { useI18n } from '../contexts/I18nContext';
import { useLocalGame } from '../contexts/LocalGameContext';
import { useGameTimer } from '../hooks/useGameTimer';
import { formatDelta } from '../game/gameEngine';
import { useState } from 'react';

export default function OfflineGamePage() {
  const { t } = useI18n();
  const history = useHistory();
  const {
    config,
    state,
    currentPlayer,
    phase,
    history: placementHistory,
    scores,
    ratings,
    result,
    turnKey,
    placeDot,
    resetGame,
    clearGame,
    onTimeout,
    isActive
  } = useLocalGame();
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  useEffect(() => {
    if (!config) history.replace('/offline');
  }, [config, history]);

  const seconds = useGameTimer({
    enabled: !!config && !!config.timerEnabled && isActive,
    turnKey,
    onTimeout
  });

  if (!config) return null;

  const name = currentPlayer === 1 ? config.player1Name : config.player2Name;
  const statusText =
    phase === 'place'
      ? t('game.phase_place', { player: name })
      : t('game.phase_eliminate', { player: name });
  const statusColor = currentPlayer === 1 ? '#dc3545' : '#007bff';

  const handleMainMenu = () => {
    clearGame();
    history.push('/offline');
  };

  const buildGameOverMessage = () => {
    if (!result) return '';
    const { winner, score1, score2, rating, timeout, loser } = result;
    const { p1 } = { p1: config.player1Name };
    const p2 = config.player2Name;
    const ratingLine = rating
      ? '\n' +
        t('game.rating_change', {
          p1,
          d1: formatDelta(rating.delta1),
          r1: rating.rating1,
          p2,
          d2: formatDelta(rating.delta2),
          r2: rating.rating2
        })
      : '';
    if (timeout) {
      const loserName = loser === 1 ? p1 : p2;
      const winnerName = winner === 1 ? p1 : p2;
      return (
        t('game.timeout_loss', { player: loserName }) +
        '\n' +
        t('game.game_over_winner', { player: winnerName }) +
        ratingLine
      );
    }
    if (winner === 0) return t('game.game_over_draw') + ratingLine;
    const winnerName = winner === 1 ? p1 : p2;
    return t('game.game_over_winner', { player: winnerName }) + ratingLine;
  };

  return (
    <IonPage>
      <AppHeader />
      <IonContent fullscreen>
        <div className="sk-tab-section ion-padding-horizontal">
          <div className="sk-game-header">
            <div className={`sk-player-info${currentPlayer === 1 ? ' active' : ''}`}>
              <div className="sk-player-name" style={{ color: '#dc3545' }}>
                {config.player1Name} ({ratings[1]})
              </div>
              <div className="sk-player-score">{scores[1]}</div>
            </div>
            <div className="sk-status" style={{ color: statusColor }}>
              {isActive ? statusText : ''}
            </div>
            <div className={`sk-player-info${currentPlayer === 2 ? ' active' : ''}`}>
              <div className="sk-player-name" style={{ color: '#007bff' }}>
                {config.player2Name} ({ratings[2]})
              </div>
              <div className="sk-player-score">{scores[2]}</div>
            </div>
          </div>

          {config.timerEnabled && isActive && (
            <div className={`sk-turn-timer${seconds <= 10 ? ' warning' : ''}`}>{seconds}</div>
          )}

          <GameBoard
            state={state}
            size={config.gridSize}
            history={placementHistory}
            onCellClick={placeDot}
            disabled={!isActive}
          />

          <div className="sk-game-controls">
            <IonButton onClick={() => setConfirmResetOpen(true)} fill="outline">
              <IonIcon slot="start" icon={refreshOutline} />
              {t('game.reset_button')}
            </IonButton>
            <IonButton onClick={handleMainMenu} fill="outline" color="medium">
              <IonIcon slot="start" icon={homeOutline} />
              {t('game.back_to_menu_button')}
            </IonButton>
          </div>
        </div>

        <IonAlert
          isOpen={confirmResetOpen}
          onDidDismiss={() => setConfirmResetOpen(false)}
          header={t('game.confirm_reset_title')}
          message={t('game.confirm_reset_message')}
          buttons={[
            { text: t('game.no_button'), role: 'cancel' },
            {
              text: t('game.yes_button'),
              handler: () => {
                resetGame();
              }
            }
          ]}
        />

        <IonAlert
          isOpen={!!result}
          backdropDismiss={false}
          header={t('game.game_over_title')}
          message={buildGameOverMessage().replace(/\n/g, '<br/>')}
          buttons={[
            {
              text: t('game.new_game_button'),
              handler: () => {
                clearGame();
                history.replace('/offline');
              }
            },
            {
              text: t('game.main_menu_button'),
              role: 'cancel',
              handler: () => {
                clearGame();
                history.replace('/offline');
              }
            }
          ]}
        />
      </IonContent>
    </IonPage>
  );
}
