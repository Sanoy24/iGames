import {
    findNearestLocation,
    GeoCandidate,
    haversineMeters,
} from './location-geo';

describe('haversineMeters', () => {
    it('is ~0 for the same point', () => {
        expect(haversineMeters(9.03, 38.74, 9.03, 38.74)).toBeCloseTo(0, 5);
    });

    it('matches a known short distance', () => {
        // Two points ~1.11 km apart (0.01° of latitude at the equator ≈ 1.11 km).
        const meters = haversineMeters(0, 0, 0.01, 0);
        expect(meters).toBeGreaterThan(1100);
        expect(meters).toBeLessThan(1120);
    });
});

describe('findNearestLocation', () => {
    const bole: GeoCandidate = {
        id: 'bole',
        name: 'Bole',
        latitude: 8.9806,
        longitude: 38.7578,
        radiusMeters: 3000,
    };
    const megenagna: GeoCandidate = {
        id: 'meg',
        name: 'Megenagna',
        latitude: 9.0206,
        longitude: 38.8,
        radiusMeters: 3000,
    };
    const listOnly: GeoCandidate = {
        id: 'x',
        name: 'Remote',
        latitude: null,
        longitude: null,
        radiusMeters: 3000,
    };

    it('returns the location whose radius contains the point', () => {
        const match = findNearestLocation([bole, megenagna], 8.981, 38.758);
        expect(match?.id).toBe('bole');
        expect(match?.distanceMeters).toBeLessThan(3000);
    });

    it('returns null when the point is outside every radius', () => {
        // Far from both (northern Ethiopia)  nothing within 3 km.
        expect(findNearestLocation([bole, megenagna], 13.5, 39.47)).toBeNull();
    });

    it('picks the nearer of two candidates when both contain the point', () => {
        const wide = { ...bole, radiusMeters: 50_000 };
        const wideMeg = { ...megenagna, radiusMeters: 50_000 };
        // Sitting right on Bole's centre  Bole must win even though both radii cover it.
        const match = findNearestLocation([wideMeg, wide], 8.9806, 38.7578);
        expect(match?.id).toBe('bole');
    });

    it('skips list-only candidates that have no coordinates', () => {
        const match = findNearestLocation([listOnly], 8.981, 38.758);
        expect(match).toBeNull();
    });

    it('returns null for non-finite input coordinates', () => {
        expect(findNearestLocation([bole], Number.NaN, 38.758)).toBeNull();
    });
});
