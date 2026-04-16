import { useEffect, useState } from 'react';
import {
  IonPage,
  IonContent,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonSpinner
} from '@ionic/react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import AppHeader from '../components/AppHeader';
import { useI18n } from '../contexts/I18nContext';
import { useLeaderboard } from '../hooks/useLeaderboard';
import { db } from '../firebase';

function Table({ rows, t, empty, keyFn, renderName, renderRating }) {
  if (!rows || rows.length === 0) {
    return <p style={{ textAlign: 'center', marginTop: 24 }}>{empty}</p>;
  }
  return (
    <table className="sk-leaderboard-table">
      <thead>
        <tr>
          <th>{t('leaderboard.rank')}</th>
          <th>{t('leaderboard.player')}</th>
          <th>{t('leaderboard.rating')}</th>
          <th>{t('leaderboard.wdl')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p, i) => (
          <tr key={keyFn(p)} className={i < 3 ? `sk-top-${i + 1}` : ''}>
            <td className="sk-rank-cell">{i + 1}</td>
            <td className="sk-name-cell">{renderName(p)}</td>
            <td className="sk-rating-cell">{renderRating(p)}</td>
            <td className="sk-wdl-cell">
              {(p.wins ?? 0)} / {(p.draws ?? 0)} / {(p.losses ?? 0)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function LeaderboardPage() {
  const { t } = useI18n();
  const { players: localPlayers } = useLeaderboard();
  const [tab, setTab] = useState('local');
  const [onlinePlayers, setOnlinePlayers] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (tab !== 'online' || onlinePlayers !== null) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    getDocs(query(collection(db, 'players'), orderBy('rating', 'desc')))
      .then((snap) => {
        if (cancelled) return;
        const arr = [];
        snap.forEach((d) => arr.push(d.data()));
        setOnlinePlayers(arr);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, onlinePlayers]);

  return (
    <IonPage>
      <AppHeader title={t('leaderboard.title')} />
      <IonContent fullscreen>
        <div className="sk-tab-section ion-padding">
          <IonSegment value={tab} onIonChange={(e) => setTab(e.detail.value)}>
            <IonSegmentButton value="local">
              <IonLabel>{t('leaderboard.local_section')}</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="online">
              <IonLabel>{t('leaderboard.online_section')}</IonLabel>
            </IonSegmentButton>
          </IonSegment>
          <div style={{ marginTop: 20 }}>
            {tab === 'local' && (
              <Table
                rows={localPlayers}
                t={t}
                empty={t('leaderboard.empty_local')}
                keyFn={(p) => p.id}
                renderName={(p) => p.name}
                renderRating={(p) => p.rating}
              />
            )}
            {tab === 'online' && loading && (
              <div style={{ textAlign: 'center', marginTop: 24 }}>
                <IonSpinner /> <div>{t('leaderboard.loading')}</div>
              </div>
            )}
            {tab === 'online' && error && (
              <p style={{ color: '#dc3545', textAlign: 'center' }}>{error}</p>
            )}
            {tab === 'online' && onlinePlayers && !loading && (
              <Table
                rows={onlinePlayers}
                t={t}
                empty={t('leaderboard.empty_online')}
                keyFn={(p) => p.displayName || Math.random()}
                renderName={(p) => p.displayName}
                renderRating={(p) => p.rating}
              />
            )}
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
}
