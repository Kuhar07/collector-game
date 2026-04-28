import { useEffect, useState } from 'react';
import {
  IonPage,
  IonContent,
  IonSpinner
} from '@ionic/react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import AppHeader from '../components/AppHeader';
import { useI18n } from '../contexts/I18nContext';
import { db } from '../firebase';
import { getEmailLocalPart } from '../utils/emailDisplay';

function Table({ rows, t, empty, keyFn, renderName, renderRating, onRowClick, selectedPlayerEmail }) {
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
        {rows.map((p, i) => {
          const isSelected = selectedPlayerEmail && p.email === selectedPlayerEmail;
          const baseClassName = i < 3 ? `sk-top-${i + 1}` : '';
          const className = isSelected ? `${baseClassName} sk-leaderboard-selected` : baseClassName;
          return (
            <tr
              key={keyFn(p)}
              className={className}
              onClick={() => onRowClick && onRowClick(p)}
              style={{ cursor: onRowClick ? 'pointer' : 'default' }}
            >
              <td className="sk-rank-cell">{i + 1}</td>
              <td className="sk-name-cell">{renderName(p)}</td>
              <td className="sk-rating-cell">{renderRating(p)}</td>
              <td className="sk-wdl-cell">
                {(p.wins ?? 0)} / {(p.draws ?? 0)} / {(p.losses ?? 0)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function LeaderboardPage() {
  const { t } = useI18n();
  const [onlinePlayers, setOnlinePlayers] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedPlayerEmail, setSelectedPlayerEmail] = useState('');

  useEffect(() => {
    if (onlinePlayers !== null) return;
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
  }, [onlinePlayers]);

  return (
    <IonPage>
      <AppHeader title={t('leaderboard.title')} />
      <IonContent fullscreen>
        <div className="sk-tab-section ion-padding">
          <div className="sk-leaderboard-container">
            {loading && (
              <div style={{ textAlign: 'center', marginTop: 24 }}>
                <IonSpinner /> <div>{t('leaderboard.loading')}</div>
              </div>
            )}
            {error && (
              <p style={{ color: '#dc3545', textAlign: 'center' }}>{error}</p>
            )}
            {onlinePlayers && !loading && (
              <Table
                rows={onlinePlayers}
                t={t}
                empty={t('leaderboard.empty_online')}
                keyFn={(p) => p.email || p.displayName || Math.random()}
                renderName={(p) => {
                  const isSelected = selectedPlayerEmail && p.email === selectedPlayerEmail;
                  const displayName = p.displayName || p.email;
                  return isSelected && p.email ? getEmailLocalPart(p.email) : displayName;
                }}
                renderRating={(p) => p.rating}
                onRowClick={(p) => {
                  const email = p.email || '';
                  setSelectedPlayerEmail((current) => (current === email ? '' : email));
                }}
                selectedPlayerEmail={selectedPlayerEmail}
              />
            )}
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
}
