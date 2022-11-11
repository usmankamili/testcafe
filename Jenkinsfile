pipeline {
    agent any

    stages {
        stage('build') {
            steps {
                echo 'Hello World'
            }
        }
        stage('test') {
            steps {
                echo 'Hello World'
            }
        }
        stage('deploy') {
            steps {
                echo 'Hello World'
            }
        }
    }
    
    post{
        always{
            emailext body: 'Summary', subject: 'Pipeline Status', to: 'automationusman29@gmail.com'
        }
    }
}
