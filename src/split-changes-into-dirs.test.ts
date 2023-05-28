import { _filterChangedDirectories } from './split-changes-into-dirs'

const files = [
    'private/test-package/deep/test/index',
    'public/test-package/deep/test/index',
    'private/test-package/test/index',
    'public/test-package/test/index',
    'private/test-package/index',
    'public/test-package/index',
    'private/config',
    'public/config',
]
const parents = [
    'private',
    'public',
]


test('filterChangedDirectories / depth 1', () => {
    expect(_filterChangedDirectories(files, parents /*, false, 1 */)).toEqual([
        'test-package',
    ])
})

test('filterChangedDirectories / depth 2', () => {
    expect(_filterChangedDirectories(files, parents, false, 2)).toEqual([
        'test-package/deep',
        'test-package/test',
    ])
})

test('filterChangedDirectories / depth 3', () => {
    expect(_filterChangedDirectories(files, parents, false, 3)).toEqual([
        'test-package/deep/test',
    ])
})

test('filterChangedDirectories / includeParents / depth 1', () => {
    expect(_filterChangedDirectories(files, parents, true /*, 1 */)).toEqual([
        'private/test-package',
        'public/test-package',
    ])
})

test('filterChangedDirectories / includeParents / depth 2', () => {
    expect(_filterChangedDirectories(files, parents, true, 2)).toEqual([
        'private/test-package/deep',
        'private/test-package/test',
        'public/test-package/deep',
        'public/test-package/test',
    ])
})

test('filterChangedDirectories / includeParents / depth 3', () => {
    expect(_filterChangedDirectories(files, parents, true, 3)).toEqual([
        'private/test-package/deep/test',
        'public/test-package/deep/test',
    ])
})