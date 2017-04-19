const gulp = require('gulp');
const del = require('del');
const babel = require('gulp-babel');

gulp.task('compile', [
  'clean',
  'copy-package-json',
  'compile-lib',
  'copy-assets',
  'compile-bin',
]);

gulp.task('compile-lib', function () {
  return gulp.src('lib/*.js')
  .pipe(babel())
  .pipe(gulp.dest('dist/lib'));
});

gulp.task('copy-assets', function () {
  return gulp.src(['assets/**'])
  .pipe(gulp.dest('dist/assets'));
});

gulp.task('compile-bin', function () {
  return gulp.src('bin/*.js')
  .pipe(babel())
  .pipe(gulp.dest('dist/bin'));
});

gulp.task('copy-package-json', function() {
  return gulp.src('package.json')
  .pipe(gulp.dest('dist'));
})

gulp.task('clean', function () {
  return del(['dist/lib', 'dist/bin', 'dist/package.json']);
});

gulp.task('default', ['compile']);
