export function getEmailLocalPart(email) {
    if (!email || typeof email !== 'string') return '';
    const atIndex = email.indexOf('@');
    return atIndex >= 0 ? email.slice(0, atIndex) : email;
}