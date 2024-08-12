import { stringInterpolator } from '@graphql-mesh/string-interpolation';

export const evaluate = (value?: any, sourceData: Record<string, any> = {}): any => {
    if (typeof value === 'string') {
        const data = {
            ...sourceData,
            env: process.env,
        };
        const result = stringInterpolator.parse(value, data);

        if (result === '') {
            return undefined;
        } else if (result === 'null') {
            return null;
        } else if (result === 'true' || result === 'false') {
            return result === 'true';
        } else if (!isNaN(Number(result))) {
            return Number(result);
        }

        return result;
    }

    return value;
};
