const gulp = require('gulp');
const del = require('del');
const path = require('path');
const babel = require('gulp-babel');


gulp.task('compile-lib', function() {
  return gulp
    .src('lib/**/*.js')
    .pipe(babel())
    .pipe(gulp.dest('dist/lib'));
});

gulp.task('copy-assets', function() {
  return gulp.src(['assets/**']).pipe(gulp.dest('dist/assets'));
});

gulp.task('compile-bin', function() {
  return gulp
    .src('bin/*.js')
    .pipe(babel())
    .pipe(gulp.dest('dist/bin'));
});

gulp.task('copy-package-json', function() {
  return gulp.src('package.json').pipe(gulp.dest('dist'));
});

gulp.task('clean', function() {
  const currentPath = path.join(process.cwd(), 'dist');
  return del([
    //remove all files in dist directory
    `${currentPath}/**/*`,
  ]);
});

gulp.task('compile', gulp.series([
  'clean',
  'copy-package-json',
  'compile-lib',
  'copy-assets',
  'compile-bin',
]));

gulp.task('default', gulp.series('compile'));
